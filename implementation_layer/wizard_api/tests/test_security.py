import pytest
from helpers import requires_postgres
from pydantic import ValidationError
from wizard_api.schemas.session import SessionCreate


def test_session_create_rejects_path_traversal_user_id() -> None:
    with pytest.raises(ValidationError):
        SessionCreate(user_id="../etc/passwd")


@requires_postgres
def test_list_sessions_isolated_by_user(client) -> None:
    """User A cannot see user B sessions via list endpoint."""
    create_a = client.post("/sessions", json={"user_id": "user-a", "title": "A"})
    create_b = client.post("/sessions", json={"user_id": "user-b", "title": "B"})
    assert create_a.status_code == 201
    assert create_b.status_code == 201

    list_a = client.get("/sessions", params={"user_id": "user-a"})
    ids = [s["id"] for s in list_a.json()["sessions"]]
    assert create_a.json()["id"] in ids
    assert create_b.json()["id"] not in ids


def test_test_hooks_disabled_by_default(client) -> None:
    assert client.post("/test/shutdown").status_code == 404
