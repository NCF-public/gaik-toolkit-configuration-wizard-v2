"""A session's export can be made into a new session at the same phase."""

import json
import stat
import uuid
import zipfile
from pathlib import Path

import pytest
from helpers import requires_postgres
from wizard_api import session_admin
from wizard_api.models import BlueprintVersion, WizardSession
from wizard_api.ownership import USER_HEADER
from wizard_api.services import session_export, session_import

ALICE = {USER_HEADER: "alice@example.com"}
BOB = {USER_HEADER: "bob@example.com"}
GATES = {"gate_1": "approved", "gate_2": "approved", "gate_3": "pending", "gate_4": "pending"}


@pytest.fixture
def exported(client, db_session, tmp_path, monkeypatch) -> tuple[Path, dict]:
    """Alice's session at step 10 with two gates approved, exported to a zip."""
    monkeypatch.setenv("WIZARD_SESSION_OUTPUT_ROOT", str(tmp_path / "sessions"))
    res = client.post(
        "/sessions", json={"user_id": "alice@example.com", "title": "Invoices"}, headers=ALICE
    )
    assert res.status_code == 201, res.text
    body = res.json()
    folder = Path(body["output_dir"])
    (folder / "poc").mkdir(parents=True)
    (folder / "poc" / "config.json").write_text(
        json.dumps({"output_dir": str(folder / "poc"), "session": body["id"]})
    )
    (folder / "poc" / "sample.bin").write_bytes(b"\xff\xfe" + body["id"].encode())
    row = db_session.get(WizardSession, uuid.UUID(body["id"]))
    row.step = 10
    row.gate_statuses = GATES
    row.aiops_recording = "stored"
    row.session_metadata = {
        **row.session_metadata,
        "messages": [
            {"role": "user", "content": "extract invoices"},
            {"role": "assistant", "content": "Gate 2 approved."},
        ],
        "agent_sdk_session_id": "11111111-1111-4111-8111-111111111111",
        "latest_package": {"path": str(folder / "poc")},
    }
    db_session.add(
        BlueprintVersion(
            session_id=row.id,
            version=2,
            note="spec",
            content={"title": "Invoices", "steps": []},
            draft={"package": {"output_dir": str(folder / "poc")}},
        )
    )
    row.active_version = 2
    db_session.commit()
    db_session.refresh(row)
    target = tmp_path / "snapshot.zip"
    with open(target, "wb") as out:
        session_export.write_archive(row, out)
    return target, body


@requires_postgres
def test_the_copy_is_a_new_session_at_the_same_phase(client, db_session, exported) -> None:
    path, original = exported
    copy = session_import.import_archive(db_session, path, "bob@example.com")

    assert str(copy.id) != original["id"]
    assert copy.user_id == "bob@example.com"
    assert (copy.step, copy.gate_statuses, copy.active_version) == (10, GATES, 2)
    assert copy.session_metadata["messages"][1]["content"] == "Gate 2 approved."
    # The agent starts from the stored conversation, not from Alice's transcript.
    assert "agent_sdk_session_id" not in copy.session_metadata
    # The answer on storing usage data was Alice's, for her session.
    assert copy.aiops_recording == "not_asked"
    assert [v.version for v in copy.blueprint_versions] == [1, 2]
    assert copy.blueprint_versions[1].draft == {
        "package": {"output_dir": str(Path(copy.output_dir) / "poc")}
    }

    res = client.get(f"/sessions/{copy.id}", headers=BOB)
    assert res.status_code == 200, res.text
    assert client.get(f"/sessions/{copy.id}", headers=ALICE).status_code == 404


@requires_postgres
def test_nothing_in_the_copy_points_at_the_original(db_session, exported) -> None:
    path, original = exported
    copy = session_import.import_archive(db_session, path, "bob@example.com")
    folder = Path(copy.output_dir)
    config = json.loads((folder / "poc" / "config.json").read_text())

    assert config == {"output_dir": str(folder / "poc"), "session": str(copy.id)}
    assert copy.session_metadata["latest_package"] == {"path": str(folder / "poc")}
    # A file that is not text is copied as it is.
    assert (folder / "poc" / "sample.bin").read_bytes() == b"\xff\xfe" + original["id"].encode()
    assert Path(original["output_dir"], "poc", "config.json").exists()


@requires_postgres
def test_one_export_gives_a_new_copy_each_time(db_session, exported) -> None:
    path, _ = exported
    first = session_import.import_archive(db_session, path, "bob@example.com")
    second = session_import.import_archive(db_session, path, "bob@example.com", title="Again")

    assert first.id != second.id
    assert first.output_dir != second.output_dir
    assert second.session_metadata["title"] == "Again"


def _zip(tmp_path: Path, record: dict, entries: dict[str, bytes], links=()) -> Path:
    target = tmp_path / "crafted.zip"
    with zipfile.ZipFile(target, "w") as archive:
        archive.writestr("session.json", json.dumps(record))
        for name, data in entries.items():
            archive.writestr(name, data)
        for name in links:
            info = zipfile.ZipInfo(name)
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, "/etc/passwd")
    return target


def _record(**changes) -> dict:
    record = {
        "session_id": str(uuid.uuid4()),
        "user_id": "alice@example.com",
        "step": 4,
        "gate_statuses": dict.fromkeys(GATES, "pending"),
        "metadata": {"title": "x", "messages": []},
        "active_version": 1,
        "blueprint_versions": [{"version": 1, "note": "", "content": {}}],
    }
    return record | changes


@requires_postgres
@pytest.mark.parametrize(
    ("entries", "links"),
    [
        ({"files/../escaped.txt": b"x"}, ()),
        ({"files//etc/escaped.txt": b"x"}, ()),
        ({"files/a\\..\\..\\escaped.txt": b"x"}, ()),
        ({"elsewhere.txt": b"x"}, ()),
        ({}, ("files/poc/link.txt",)),
    ],
    ids=["dot-dot", "absolute", "backslash", "outside-files", "link"],
)
def test_an_unsafe_archive_leaves_nothing_behind(
    db_session, tmp_path, monkeypatch, entries, links
) -> None:
    root = tmp_path / "sessions"
    monkeypatch.setenv("WIZARD_SESSION_OUTPUT_ROOT", str(root))
    path = _zip(tmp_path, _record(), {"files/ok.txt": b"fine", **entries}, links)

    with pytest.raises(session_import.InvalidExportError):
        session_import.import_archive(db_session, path, "bob@example.com")

    assert db_session.query(WizardSession).count() == 0
    assert not root.exists() or not any(root.rglob("*.txt"))
    assert not (tmp_path / "escaped.txt").exists()


@requires_postgres
@pytest.mark.parametrize(
    "changes",
    [
        {"step": 99},
        {"step": "4"},
        {"gate_statuses": {"gate_1": "approved"}},
        {"gate_statuses": {"gate_1": "maybe", "gate_2": "pending"}},
        {"blueprint_versions": []},
        {"active_version": 7},
        {"session_id": "not-an-id"},
    ],
)
def test_a_record_that_is_not_a_session_is_refused(
    db_session, tmp_path, monkeypatch, changes
) -> None:
    monkeypatch.setenv("WIZARD_SESSION_OUTPUT_ROOT", str(tmp_path / "sessions"))
    path = _zip(tmp_path, _record(**changes), {})

    with pytest.raises(session_import.InvalidExportError):
        session_import.import_archive(db_session, path, "bob@example.com")
    assert db_session.query(WizardSession).count() == 0


def test_a_file_that_is_not_a_zip_is_refused(tmp_path) -> None:
    path = tmp_path / "x.zip"
    path.write_bytes(b"not a zip")
    with pytest.raises(session_import.InvalidExportError):
        session_import.import_archive(None, path, "bob@example.com")


@requires_postgres
def test_the_operator_imports_an_export(db_session, exported, capsys) -> None:
    path, _ = exported
    session_admin.main(["import", str(path), "--user", "bob@example.com"])
    out = capsys.readouterr().out
    copy = db_session.query(WizardSession).filter_by(user_id="bob@example.com").one()
    assert out.startswith(f"{copy.id}  step 10")


@requires_postgres
def test_the_operator_hears_why_an_archive_was_refused(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("WIZARD_SESSION_OUTPUT_ROOT", str(tmp_path / "sessions"))
    path = _zip(tmp_path, _record(step=99), {})
    with pytest.raises(SystemExit, match="not imported: session.json: step"):
        session_admin.main(["import", str(path), "--user", "bob@example.com"])
