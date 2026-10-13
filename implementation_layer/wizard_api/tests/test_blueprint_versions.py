from helpers import requires_postgres


@requires_postgres
def test_create_session_seeds_blueprint_version(client) -> None:
    create = client.post(
        "/sessions",
        json={"user_id": "bp-user", "title": "Invoice bot"},
    )
    assert create.status_code == 201
    body = create.json()
    assert body["title"] == "Invoice bot"
    assert body["active_version"] == 1
    assert len(body["versions"]) == 1
    assert body["versions"][0]["version"] == 1
    assert body["blueprint"]["name"] == "Invoice bot"
    assert len(body["blueprint"]["steps"]) >= 1


@requires_postgres
def test_append_version_and_resume(client) -> None:
    create = client.post(
        "/sessions",
        json={"user_id": "bp-user", "title": "Resume test"},
    )
    session_id = create.json()["id"]

    versioned = client.post(
        f"/sessions/{session_id}/versions",
        json={"note": "Vaihe 2"},
    )
    assert versioned.status_code == 200
    body = versioned.json()
    assert body["active_version"] == 2
    assert len(body["versions"]) == 2

    resumed = client.get(f"/sessions/{session_id}")
    assert resumed.status_code == 200
    assert resumed.json()["active_version"] == 2


@requires_postgres
def test_messages_persist_on_session(client) -> None:
    create = client.post("/sessions", json={"user_id": "chat-user", "title": "Chat"})
    session_id = create.json()["id"]

    updated = client.post(
        f"/sessions/{session_id}/messages",
        json={
            "user_content": "Hello",
            "assistant_content": "Mock reply",
        },
    )
    assert updated.status_code == 200
    messages = updated.json()["messages"]
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[1]["content"] == "Mock reply"

    fetched = client.get(f"/sessions/{session_id}")
    assert len(fetched.json()["messages"]) == 2
