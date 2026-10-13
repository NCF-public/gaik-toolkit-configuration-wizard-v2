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

    async def fake_get_or_create_session(session_id, output_dir, locale=None, **kwargs):
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


@requires_postgres
def test_a_chat_turn_resumes_the_remembered_cli_session_and_tells_about_a_restart(
    client, monkeypatch
):
    """#174: the api hands the stored CLI session id to the agent bridge; when the
    bridge had to re-bootstrap from the transcript, the chat says so once; the id
    the bridge reports is remembered for the next process."""
    import asyncio

    from wizard_api.services import agent_service

    calls: list[dict] = []

    async def fake_get_or_create_session(session_id, output_dir, locale=None, **kwargs):
        calls.append(kwargs)
        return {
            "lock": asyncio.Lock(),
            "resumed": "transcript",
            "notice_pending": True,
            "sdk_session_id": "sdk-new",
        }

    async def fake_stream_turn_for(agent, message, parts):
        parts.append("Jatketaan siitä mihin jäimme.")
        yield agent_service.sse({"delta": "Jatketaan siitä mihin jäimme."})

    monkeypatch.setattr(agent_service, "get_or_create_session", fake_get_or_create_session)
    monkeypatch.setattr(agent_service, "stream_turn_for", fake_stream_turn_for)

    created = client.post("/sessions", json={"user_id": "resume", "title": "Resume"}).json()
    sid = created["id"]
    client.patch(f"/sessions/{sid}", json={"metadata": {"agent_sdk_session_id": "sdk-old"}})

    res = client.post(f"/sessions/{sid}/chat", json={"message": "jatka", "locale": "fi"})

    assert res.status_code == 200
    assert calls[0]["resume_id"] == "sdk-old"
    frames = [line[len("data: ") :] for line in res.text.split("\n\n") if line.startswith("data: ")]
    import json

    assert json.loads(frames[0]) == {"delta": agent_service.RESTART_NOTICE["fi"]}  # first
    detail = client.get(f"/sessions/{sid}").json()
    assert detail["metadata"]["agent_sdk_session_id"] == "sdk-new"
    assert detail["metadata"]["messages"][-1]["content"].startswith("⟳ Wizard käynnistettiin")


@requires_postgres
def test_a_resume_that_fails_on_its_first_turn_falls_back_to_the_transcript_and_retries(
    client, monkeypatch
):
    """Janne's review of #286: the CLI starts with --resume <id> and says "No
    conversation found" only on the first turn. The stale id must not stick."""
    import asyncio
    import json

    from wizard_api.services import agent_service

    calls: list[dict] = []
    agents: list[dict] = []

    async def fake_get_or_create_session(session_id, output_dir, locale=None, **kwargs):
        calls.append(kwargs)
        resumed = "sdk" if kwargs.get("resume_id") else "transcript"
        agent = {
            "lock": asyncio.Lock(),
            "resumed": resumed,
            "notice_pending": resumed == "transcript",
            "sdk_session_id": kwargs.get("resume_id") or "sdk-fresh",
        }
        agents.append(agent)
        return agent

    async def fake_end_session(session_id):
        return True

    async def fake_stream_turn_for(agent, message, parts):
        if agent["resumed"] == "sdk":
            yield agent_service.sse({"error": True, "message": "No conversation found"})
            return
        parts.append("Jatketaan.")
        yield agent_service.sse({"delta": "Jatketaan."})
        yield agent_service.sse({"done": True})

    monkeypatch.setattr(agent_service, "get_or_create_session", fake_get_or_create_session)
    monkeypatch.setattr(agent_service, "end_session", fake_end_session)
    monkeypatch.setattr(agent_service, "stream_turn_for", fake_stream_turn_for)

    created = client.post("/sessions", json={"user_id": "resume2", "title": "Stale"}).json()
    sid = created["id"]
    client.patch(f"/sessions/{sid}", json={"metadata": {"agent_sdk_session_id": "sdk-stale"}})

    res = client.post(f"/sessions/{sid}/chat", json={"message": "jatka", "locale": "en"})

    assert res.status_code == 200
    frames = [
        json.loads(line[len("data: ") :])
        for line in res.text.split("\n\n")
        if line.startswith("data: ")
    ]
    assert not any(f.get("error") for f in frames)  # the error was swallowed and retried
    assert frames[0] == {"delta": agent_service.RESTART_NOTICE["en"]}
    assert {"delta": "Jatketaan."} in frames and frames[-1] == {"done": True}
    assert [c.get("resume_id") for c in calls] == ["sdk-stale", None]
    detail = client.get(f"/sessions/{sid}").json()
    assert detail["metadata"]["agent_sdk_session_id"] == "sdk-fresh"
    assert detail["metadata"]["messages"][-1]["content"].endswith("Jatketaan.")
