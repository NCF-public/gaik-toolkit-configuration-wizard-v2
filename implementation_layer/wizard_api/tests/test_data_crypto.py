"""The users' conversation and blueprints are stored encrypted in the database."""

import base64
import json
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from conftest import requires_postgres
from sqlalchemy import text
from wizard_api import config, data_crypto
from wizard_api.data_crypto import DataKeyError, parse_keys
from wizard_api.models import BlueprintVersion, WizardSession
from wizard_api.services import session_removal

KEY_A = base64.b64encode(b"a" * 32).decode()
KEY_B = base64.b64encode(b"b" * 32).decode()


@pytest.fixture(autouse=True)
def _keys_from_this_test_only():
    config.forget_consumed_secret(config.DATA_KEYS_ENV)
    yield
    config.forget_consumed_secret(config.DATA_KEYS_ENV)


def use_keys(monkeypatch, value: str | None) -> None:
    config.forget_consumed_secret(config.DATA_KEYS_ENV)
    if value is None:
        monkeypatch.delenv(config.DATA_KEYS_ENV, raising=False)
    else:
        monkeypatch.setenv(config.DATA_KEYS_ENV, value)


def raw(db, table: str, column: str, row_id) -> dict | None:
    return db.execute(
        text(f"SELECT {column} FROM {table} WHERE id = :id"), {"id": row_id}
    ).scalar_one()


def new_session(db, metadata: dict) -> WizardSession:
    session = WizardSession(user_id="u1", output_dir="/tmp/x", session_metadata=metadata)
    db.add(session)
    db.commit()
    return session


# --- the keys ----------------------------------------------------------------


def test_the_first_listed_key_encrypts_and_every_listed_key_decrypts() -> None:
    keys = parse_keys(f"k2:{KEY_B}, k1:{KEY_A}")
    assert keys.current == "k2"
    assert set(keys.keys) == {"k1", "k2"}
    assert parse_keys(None) is None and parse_keys("  ") is None


@pytest.mark.parametrize(
    "value",
    [
        "k1",
        f"k1:{KEY_A},k1:{KEY_B}",
        "k1:not-base64!",
        f"k1:{base64.b64encode(b'short').decode()}",
        f"bad id:{KEY_A}",
    ],
)
def test_a_malformed_key_list_is_refused_without_showing_a_key(value) -> None:
    with pytest.raises(DataKeyError) as refused:
        parse_keys(value)
    assert KEY_A not in str(refused.value) and KEY_B not in str(refused.value)


def test_the_keys_are_taken_out_of_the_environment(monkeypatch) -> None:
    use_keys(monkeypatch, f"k1:{KEY_A}")
    assert data_crypto.data_keys().current == "k1"
    assert config.DATA_KEYS_ENV not in os.environ
    assert config.DATA_KEYS_ENV in config.API_SECRET_ENV


# --- stored encrypted --------------------------------------------------------


@requires_postgres
def test_the_conversation_is_stored_encrypted_and_read_back(db_session, monkeypatch) -> None:
    use_keys(monkeypatch, f"k1:{KEY_A}")
    said = "Our invoices from Acme Oy, 2 400 EUR"
    session = new_session(
        db_session,
        {"messages": [{"role": "user", "content": said}], "agent_sdk_session_id": "c-1"},
    )
    stored = raw(db_session, "wizard_sessions", "metadata", session.id)
    assert said not in str(stored)
    assert data_crypto.key_id_of(stored) == "k1"
    # The conversation id stays readable for the SQL that needs it.
    assert stored["agent_sdk_session_id"] == "c-1"
    db_session.expire_all()
    again = db_session.get(WizardSession, session.id)
    assert again.session_metadata["messages"][0]["content"] == said
    assert again.session_metadata["agent_sdk_session_id"] == "c-1"


@requires_postgres
def test_the_blueprint_and_its_draft_are_stored_encrypted(db_session, monkeypatch) -> None:
    use_keys(monkeypatch, f"k1:{KEY_A}")
    session = new_session(db_session, {})
    version = BlueprintVersion(
        session_id=session.id,
        version=1,
        note="",
        content={"use_case": "Payroll of Virtanen"},
        draft={"steps": ["Virtanen's payslip"]},
    )
    empty = BlueprintVersion(session_id=session.id, version=2, note="", content={})
    db_session.add_all([version, empty])
    db_session.commit()
    assert "Virtanen" not in str(raw(db_session, "blueprint_versions", "content", version.id))
    assert "Virtanen" not in str(raw(db_session, "blueprint_versions", "draft", version.id))
    # A version without a draft keeps SQL NULL, which the drafts query reads.
    assert raw(db_session, "blueprint_versions", "draft", empty.id) is None
    db_session.expire_all()
    assert db_session.get(BlueprintVersion, version.id).draft == {"steps": ["Virtanen's payslip"]}


@requires_postgres
def test_the_other_sessions_conversation_ids_are_found_through_encryption(
    db_session, monkeypatch
) -> None:
    use_keys(monkeypatch, f"k1:{KEY_A}")
    first, second = str(uuid.uuid4()), str(uuid.uuid4())
    mine = new_session(db_session, {"agent_sdk_session_id": str(uuid.uuid4())})
    new_session(
        db_session,
        {"agent_sdk_session_id": second, session_removal.CONVERSATIONS_KEY: [first, second]},
    )
    assert session_removal._claimed_elsewhere(db_session, mine) == {first, second}


@requires_postgres
def test_a_value_does_not_open_in_another_column(db_session, monkeypatch) -> None:
    use_keys(monkeypatch, f"k1:{KEY_A}")
    session = new_session(db_session, {"messages": ["x"]})
    version = BlueprintVersion(session_id=session.id, version=1, note="", content={"a": 1})
    db_session.add(version)
    db_session.commit()
    sealed = raw(db_session, "wizard_sessions", "metadata", session.id)
    db_session.execute(
        text("UPDATE blueprint_versions SET content = CAST(:v AS jsonb) WHERE id = :id"),
        {"v": json.dumps(sealed), "id": version.id},
    )
    db_session.commit()
    db_session.expire_all()
    with pytest.raises(DataKeyError):
        db_session.get(BlueprintVersion, version.id).content  # noqa: B018


@requires_postgres
def test_a_value_for_a_key_not_listed_is_an_error_not_an_empty_value(
    db_session, monkeypatch
) -> None:
    use_keys(monkeypatch, f"k1:{KEY_A}")
    session = new_session(db_session, {"messages": ["kept"]})
    use_keys(monkeypatch, f"k2:{KEY_B}")
    db_session.expire_all()
    with pytest.raises(DataKeyError, match="k1"):
        db_session.get(WizardSession, session.id).session_metadata  # noqa: B018


# --- before keys, and changing the key ----------------------------------------


@requires_postgres
def test_without_keys_the_data_is_plain_and_reads_as_before(db_session, monkeypatch) -> None:
    use_keys(monkeypatch, None)
    session = new_session(db_session, {"messages": ["plain"]})
    assert raw(db_session, "wizard_sessions", "metadata", session.id) == {"messages": ["plain"]}
    assert "not set" in data_crypto.startup_report(db_session)
    assert data_crypto.reencrypt(db_session) == 0


@requires_postgres
def test_plain_rows_are_encrypted_at_start_and_keep_their_dates(db_session, monkeypatch) -> None:
    use_keys(monkeypatch, None)
    session = new_session(db_session, {"messages": ["from before"]})
    version = BlueprintVersion(session_id=session.id, version=1, note="", content={"a": "b"})
    db_session.add(version)
    db_session.commit()
    old = datetime.now(UTC) - timedelta(days=80)
    db_session.execute(
        text("UPDATE wizard_sessions SET updated_at = :t WHERE id = :id"),
        {"t": old, "id": session.id},
    )
    db_session.commit()

    use_keys(monkeypatch, f"k1:{KEY_A}")
    # A plain value still reads before it is written again.
    db_session.expire_all()
    assert db_session.get(WizardSession, session.id).session_metadata == {
        "messages": ["from before"]
    }
    assert data_crypto.reencrypt(db_session, batch=1) == 2
    assert data_crypto.key_id_of(raw(db_session, "wizard_sessions", "metadata", session.id)) == "k1"
    assert data_crypto.key_id_of(raw(db_session, "blueprint_versions", "content", version.id)) == (
        "k1"
    )
    updated = db_session.execute(
        text("SELECT updated_at FROM wizard_sessions WHERE id = :id"), {"id": session.id}
    ).scalar_one()
    assert abs((updated - old).total_seconds()) < 1
    # Nothing is left to do: a second run writes nothing.
    assert data_crypto.reencrypt(db_session) == 0
    assert data_crypto.column_state(db_session)["wizard_sessions.metadata"] == {"k1": 1}


@requires_postgres
def test_a_new_key_put_first_takes_over_and_the_old_one_can_then_go(
    db_session, monkeypatch
) -> None:
    use_keys(monkeypatch, f"k1:{KEY_A}")
    session = new_session(db_session, {"messages": ["across keys"]})
    use_keys(monkeypatch, f"k2:{KEY_B},k1:{KEY_A}")
    assert data_crypto.reencrypt(db_session) == 1
    assert data_crypto.key_id_of(raw(db_session, "wizard_sessions", "metadata", session.id)) == "k2"
    use_keys(monkeypatch, f"k2:{KEY_B}")
    db_session.expire_all()
    assert db_session.get(WizardSession, session.id).session_metadata == {
        "messages": ["across keys"]
    }
    assert "0 values not on it" in data_crypto.startup_report(db_session)


def test_the_api_re_encrypts_before_it_serves() -> None:
    dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text()
    for line in (line for line in dockerfile.splitlines() if line.startswith("CMD")):
        assert line.index("alembic upgrade head") < line.index("data_crypto start &&")
        assert line.index("data_crypto start &&") < line.index("uvicorn")


@requires_postgres
def test_the_values_can_be_written_back_plain_for_an_older_api(db_session, monkeypatch) -> None:
    use_keys(monkeypatch, f"k1:{KEY_A}")
    session = new_session(db_session, {"messages": ["back"], "agent_sdk_session_id": "c"})
    assert data_crypto.write_plain(db_session) == 1
    assert raw(db_session, "wizard_sessions", "metadata", session.id) == {
        "messages": ["back"],
        "agent_sdk_session_id": "c",
    }
    # Writing goes back to encrypting afterwards.
    db_session.expire_all()
    again = db_session.get(WizardSession, session.id)
    again.session_metadata = {**again.session_metadata, "step": 2}
    db_session.commit()
    assert data_crypto.key_id_of(raw(db_session, "wizard_sessions", "metadata", session.id)) == "k1"


# --- the reserved key, starting, and going back --------------------------------


@requires_postgres
@pytest.mark.parametrize("keys", [None, f"k1:{KEY_A}"])
def test_a_value_with_the_reserved_key_is_not_stored(db_session, monkeypatch, keys) -> None:
    use_keys(monkeypatch, keys)
    db_session.add(WizardSession(user_id="u1", output_dir="/x", session_metadata={"_enc": "x"}))
    with pytest.raises(Exception, match="reserved"):
        db_session.commit()
    db_session.rollback()


def test_a_caller_cannot_set_the_reserved_key() -> None:
    from wizard_api.services import session_import, session_service

    with pytest.raises(session_service.ServerOwnedMetadataError):
        session_service.check_metadata_patch({"_enc": "v1:k1:AAAA"})
    assert "_enc" in session_import._NOT_COPIED


@requires_postgres
def test_the_api_does_not_start_without_keys_once_values_are_encrypted(
    db_session, monkeypatch
) -> None:
    use_keys(monkeypatch, f"k1:{KEY_A}")
    new_session(db_session, {"messages": ["kept"]})
    assert data_crypto.start(db_session) == 0
    use_keys(monkeypatch, None)
    assert data_crypto.start(db_session) == 1


@requires_postgres
def test_going_back_writes_everything_plain_and_keeps_it_plain(db_session, monkeypatch) -> None:
    use_keys(monkeypatch, f"k1:{KEY_A}")
    session = new_session(db_session, {"messages": ["one"]})
    monkeypatch.setenv(data_crypto.PLAIN_ENV, "1")
    assert data_crypto.start(db_session) == 0
    assert "writing plain; 0 values still encrypted" in data_crypto.startup_report(db_session)
    assert raw(db_session, "wizard_sessions", "metadata", session.id) == {"messages": ["one"]}
    # A turn written while it runs so is plain too, so nothing is left for an older api.
    db_session.expire_all()
    again = db_session.get(WizardSession, session.id)
    again.session_metadata = {"messages": ["one", "two"]}
    db_session.commit()
    assert raw(db_session, "wizard_sessions", "metadata", session.id) == {
        "messages": ["one", "two"]
    }
    # Without the keys too, then: nothing is encrypted.
    use_keys(monkeypatch, None)
    assert data_crypto.start(db_session) == 0


@requires_postgres
def test_a_key_id_with_an_underscore_is_matched_exactly(db_session, monkeypatch) -> None:
    use_keys(monkeypatch, f"k_1:{KEY_A}")
    new_session(db_session, {"messages": ["x"]})
    use_keys(monkeypatch, f"kx1:{KEY_B},k_1:{KEY_A}")
    assert data_crypto.reencrypt(db_session) == 1
    assert data_crypto.reencrypt(db_session) == 0
