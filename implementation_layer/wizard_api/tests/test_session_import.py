"""A session's export can be made into a new session at the same phase."""

import json
import stat
import uuid
import zipfile
from pathlib import Path
from types import SimpleNamespace

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
def test_a_copy_takes_a_place_under_the_users_session_limit(
    db_session, exported, monkeypatch
) -> None:
    from wizard_api.models import UsageTotal
    from wizard_api.services import usage_caps

    path, _ = exported
    monkeypatch.setenv("WIZARD_MAX_SESSIONS_PER_USER", "2")
    session_import.import_archive(db_session, path, "bob@example.com")
    session_import.import_archive(db_session, path, "bob@example.com")
    with pytest.raises(usage_caps.SessionLimitError):
        session_import.import_archive(db_session, path, "bob@example.com")

    assert db_session.query(WizardSession).filter_by(user_id="bob@example.com").count() == 2
    held = db_session.query(UsageTotal).filter_by(key="bob@example.com").one().sessions_held
    assert held == 2


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


@requires_postgres
def test_a_copy_made_under_another_output_root_points_at_its_own_folder(
    db_session, exported, tmp_path, monkeypatch
) -> None:
    """A snapshot of the Docker stack (/data/sessions) imported by an API run on the host."""
    path, original = exported
    monkeypatch.setenv("WIZARD_SESSION_OUTPUT_ROOT", str(tmp_path / "elsewhere"))
    copy = session_import.import_archive(db_session, path, "bob@example.com")
    folder = Path(copy.output_dir)

    assert folder.is_relative_to(tmp_path / "elsewhere")
    config = json.loads((folder / "poc" / "config.json").read_text())
    assert config["output_dir"] == str(folder / "poc")
    assert copy.session_metadata["latest_package"] == {"path": str(folder / "poc")}
    assert original["output_dir"] not in json.dumps(copy.session_metadata)


@requires_postgres
@pytest.mark.parametrize(
    "source_root",
    ["/snapshots", "/data/my sessions/alice@example.com"],
    ids=["shallow-root", "root-with-spaces"],
)
def test_the_folder_the_export_names_is_rewritten_into_the_copy(
    db_session, tmp_path, monkeypatch, source_root
) -> None:
    monkeypatch.setenv("WIZARD_SESSION_OUTPUT_ROOT", str(tmp_path / "sessions"))
    old = str(uuid.uuid4())
    source = f"{source_root}/{old}"
    record = _record(
        session_id=old,
        output_dir=source,
        metadata={"title": "x", "messages": [], "latest_package": {"path": f"{source}/poc"}},
        blueprint_versions=[
            {
                "version": 1,
                "note": "",
                "content": {},
                "draft": {"package": {"output_dir": f"{source}/poc"}},
            }
        ],
    )
    files = {"files/poc/config.json": json.dumps({"output_dir": f"{source}/poc"}).encode()}

    copy = session_import.import_archive(
        db_session, _zip(tmp_path, record, files), "bob@example.com"
    )
    poc = str(Path(copy.output_dir) / "poc")

    config = json.loads((Path(copy.output_dir) / "poc" / "config.json").read_text())
    assert config == {"output_dir": poc}
    assert copy.session_metadata["latest_package"] == {"path": poc}
    assert copy.blueprint_versions[0].draft == {"package": {"output_dir": poc}}
    assert source_root not in json.dumps(copy.session_metadata)


@requires_postgres
@pytest.mark.parametrize("named", ["/", "/data/sessions/alice@example.com", "relative/x"])
def test_a_folder_that_is_not_the_sessions_own_is_not_rewritten(
    db_session, tmp_path, monkeypatch, named
) -> None:
    monkeypatch.setenv("WIZARD_SESSION_OUTPUT_ROOT", str(tmp_path / "sessions"))
    files = {"files/notes.txt": b"see /data/sessions/alice@example.com/other and relative/x"}
    record = _record(output_dir=named)

    copy = session_import.import_archive(
        db_session, _zip(tmp_path, record, files), "bob@example.com"
    )

    assert (Path(copy.output_dir) / "notes.txt").read_bytes() == files["files/notes.txt"]


def test_the_old_folder_is_found_by_its_id_but_a_url_is_left_alone() -> None:
    old = str(uuid.uuid4())
    text = (
        f'"/data/sessions/alice@example.com/{old}/poc" and /srv/x/o_1/{old}, '
        f"see https://wizard.example/sessions/{old} or /api/sessions/{old}"
    )
    found = session_import._old_folders(old).sub("NEW", text)

    assert found == (
        f'"NEW/poc" and NEW, see https://wizard.example/sessions/{old} or /api/sessions/{old}'
    )


@requires_postgres
def test_an_operators_mark_to_keep_a_session_is_not_copied(
    db_session, tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("WIZARD_SESSION_OUTPUT_ROOT", str(tmp_path / "sessions"))
    record = _record(metadata={"title": "x", "messages": [], "protected": True})
    copy = session_import.import_archive(db_session, _zip(tmp_path, record, {}), "bob@example.com")

    assert "protected" not in copy.session_metadata


@requires_postgres
def test_a_copy_past_gate_3_keeps_its_approval_after_the_rewrite(
    client, db_session, tmp_path, monkeypatch
) -> None:
    from wizard_api.services import session_service

    root = tmp_path / "sessions"
    monkeypatch.setenv("WIZARD_SESSION_OUTPUT_ROOT", str(root))
    old = str(uuid.uuid4())
    old_folder = root / "alice@example.com" / old
    blueprint = {"target_output_spec": {"fields": ["total"]}}
    files = {
        "files/use_case.blueprint.json": json.dumps(blueprint).encode(),
        "files/poc/run_poc.py": b"print('run')\n",
        # The package names the session's folder, so the rewrite changes its digest.
        "files/poc/config.json": json.dumps({"output_dir": f"{old_folder}/poc"}).encode(),
    }
    staged = tmp_path / "original"
    for name, data in files.items():
        (staged / name).parent.mkdir(parents=True, exist_ok=True)
        (staged / name).write_bytes(data)
    approved = session_service.approved_content(SimpleNamespace(output_dir=str(staged / "files")))
    gates = {"gate_1": "approved", "gate_2": "approved", "gate_3": "approved", "gate_4": "pending"}
    record = _record(
        session_id=old,
        step=10,
        gate_statuses=gates,
        metadata={
            "title": "x",
            "messages": [],
            "approved_content": approved,
            "last_successful_run_package": approved["package"],
        },
    )

    copy = session_import.import_archive(
        db_session, _zip(tmp_path, record, files), "alice@example.com"
    )
    now = session_service.approved_content(copy)

    assert now["package"] != approved["package"]
    assert copy.session_metadata["approved_content"] == now
    assert copy.session_metadata["last_successful_run_package"] == now["package"]
    assert session_service.reopen_if_approved_content_changed(db_session, copy) is False
    assert copy.gate_statuses["gate_3"] == "approved"


@requires_postgres
def test_a_failure_while_writing_leaves_no_session_folder_or_place(
    db_session, tmp_path, monkeypatch
) -> None:
    from wizard_api.models import UsageTotal

    root = tmp_path / "sessions"
    monkeypatch.setenv("WIZARD_SESSION_OUTPUT_ROOT", str(root))
    # A file and a folder of one name: the archive passes the checks and fails on disk.
    path = _zip(tmp_path, _record(), {"files/poc/a": b"file", "files/poc/a/b.txt": b"x"})

    with pytest.raises(OSError):
        session_import.import_archive(db_session, path, "bob@example.com")

    assert db_session.query(WizardSession).count() == 0
    assert db_session.query(UsageTotal).filter_by(key="bob@example.com").count() == 0
    assert not root.exists() or not any(p.is_file() for p in root.rglob("*"))


@requires_postgres
def test_a_user_that_names_no_folder_under_the_root_is_refused(
    db_session, tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("WIZARD_SESSION_OUTPUT_ROOT", str(tmp_path / "sessions"))
    path = _zip(tmp_path, _record(), {})

    with pytest.raises(session_import.InvalidExportError, match="no folder under"):
        session_import.import_archive(db_session, path, "..")
    with pytest.raises(SystemExit, match="must be an e-mail address or an owner id"):
        session_admin.main(["import", str(path), "--user", ".."])


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
