from helpers import requires_postgres


@requires_postgres
def test_create_get_patch_session(client) -> None:
    create = client.post(
        "/sessions",
        json={
            "user_id": "user-demo",
            "metadata": {"use_case": "PO PDF extraction"},
        },
    )
    assert create.status_code == 201
    body = create.json()
    session_id = body["id"]
    assert body["step"] == 1
    assert body["gate_statuses"]["gate_1"] == "pending"
    assert body["metadata"]["use_case"] == "PO PDF extraction"
    assert body["active_version"] == 1
    assert body["output_dir"].endswith(session_id)

    fetched = client.get(f"/sessions/{session_id}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == session_id

    patched = client.patch(
        f"/sessions/{session_id}",
        json={"step": 3, "gate_statuses": {"gate_1": "approved"}},
    )
    assert patched.status_code == 200
    updated = patched.json()
    assert updated["step"] == 3
    assert updated["gate_statuses"]["gate_1"] == "approved"
    assert updated["gate_statuses"]["gate_2"] == "pending"


@requires_postgres
def test_list_sessions_for_user(client) -> None:
    client.post("/sessions", json={"user_id": "lister"})
    client.post("/sessions", json={"user_id": "lister"})

    listed = client.get("/sessions", params={"user_id": "lister"})
    assert listed.status_code == 200
    assert len(listed.json()["sessions"]) == 2


@requires_postgres
def test_get_missing_session_returns_404(client) -> None:
    missing = client.get("/sessions/00000000-0000-0000-0000-000000000099")
    assert missing.status_code == 404


def test_patch_invalid_step_returns_422(api_client) -> None:
    """Validation runs before DB — works without Postgres."""
    response = api_client.patch(
        "/sessions/00000000-0000-0000-0000-000000000001",
        json={"step": 0},
    )
    assert response.status_code == 422


@requires_postgres
def test_patch_cannot_step_past_a_pending_gate(client) -> None:
    """The endpoint itself refuses it, not just the browser (customer test report, T4).

    The agent reaches wizard_api directly, so a check that lives only in the UI
    is no check at all: a chat "yes" walked the session past Gate 1 while the
    screen still showed the approval button.
    """
    session_id = client.post("/sessions", json={"user_id": "user-gate"}).json()["id"]

    # Reaching the gate is fine.
    assert client.patch(f"/sessions/{session_id}", json={"step": 4}).status_code == 200

    # Passing it is not.
    blocked = client.patch(f"/sessions/{session_id}", json={"step": 5})
    assert blocked.status_code == 409
    detail = blocked.json()["detail"]
    assert detail["error"] == "gate_not_approved"
    assert detail["gate"] == "gate_1"
    assert detail["gate_step"] == 4

    # The session did not move.
    assert client.get(f"/sessions/{session_id}").json()["step"] == 4

    # Approving and advancing in one request is allowed.
    ok = client.patch(
        f"/sessions/{session_id}",
        json={"step": 5, "gate_statuses": {"gate_1": "approved"}},
    )
    assert ok.status_code == 200
    assert ok.json()["step"] == 5


@requires_postgres
def test_going_back_keeps_the_approval_and_the_way_forward(client) -> None:
    """22 / R8: going back cost the user the approval they had already given."""
    session_id = client.post("/sessions", json={"user_id": "user-back"}).json()["id"]
    client.patch(
        f"/sessions/{session_id}",
        json={"step": 5, "gate_statuses": {"gate_1": "approved"}},
    )

    assert client.patch(f"/sessions/{session_id}", json={"step": 2}).status_code == 200
    assert client.get(f"/sessions/{session_id}").json()["gate_statuses"]["gate_1"] == "approved"

    forward = client.patch(f"/sessions/{session_id}", json={"step": 5})
    assert forward.status_code == 200
    assert forward.json()["step"] == 5


@requires_postgres
def test_the_agent_gets_the_gate_state_and_the_transcript_keeps_the_users_words(
    client, monkeypatch
):
    """#173: a chat "kyllä" is not an approval. The agent is told the UI's gate
    state with every message so it waits at a pending gate; the stored
    transcript shows what the user actually wrote."""
    import asyncio

    from wizard_api.services import agent_service

    seen: list[str] = []

    async def fake_get_or_create_session(session_id, output_dir, locale=None):
        return {"lock": asyncio.Lock()}

    async def fake_stream_turn_for(agent, message, parts):
        seen.append(message)
        parts.append("Odotan hyväksyntää paneelista.")
        yield agent_service.sse({"text": "Odotan hyväksyntää paneelista."})

    monkeypatch.setattr(agent_service, "get_or_create_session", fake_get_or_create_session)
    monkeypatch.setattr(agent_service, "stream_turn_for", fake_stream_turn_for)

    created = client.post("/sessions", json={"user_id": "gate-user", "title": "Gate"}).json()
    sid = created["id"]
    client.patch(f"/sessions/{sid}", json={"step": 4})

    res = client.post(f"/sessions/{sid}/chat", json={"message": "kyllä"})

    assert res.status_code == 200
    assert seen == [
        "[Session state: step 4 of 13; gate_1 pending, gate_2 pending, "
        "gate_3 pending, gate_4 pending]\n\nkyllä"
    ]
    detail = client.get(f"/sessions/{sid}").json()
    assert detail["metadata"]["messages"][-2]["content"] == "kyllä"
    assert detail["step"] == 4  # the chat reply moved nothing
