"""PoC package endpoints (#151): listing and zip download."""

import io
import os
import uuid
import zipfile

from helpers import requires_postgres
from wizard_api.services import session_service


def _session_output_dir(db_session, session_id: str) -> str:
    session = session_service.get_session(db_session, uuid.UUID(session_id))
    return session.output_dir


def _write_poc(output_dir: str) -> None:
    """Stand in for the V1 Phase 10 scaffolder."""
    poc = os.path.join(output_dir, "poc")
    os.makedirs(os.path.join(poc, "schemas"), exist_ok=True)
    with open(os.path.join(poc, "run.py"), "w", encoding="utf-8") as fh:
        fh.write("print('poc')\n")
    with open(os.path.join(poc, "schemas", "output_schema.json"), "w", encoding="utf-8") as fh:
        fh.write("{}\n")


@requires_postgres
def test_poc_files_reports_nothing_until_the_scaffolder_has_run(client, db_session) -> None:
    created = client.post("/sessions", json={"user_id": "poc-user", "title": "PoC"}).json()

    listed = client.get(f"/sessions/{created['id']}/poc/files")
    assert listed.status_code == 200
    assert listed.json() == {"generated": False, "files": []}

    # And the download says 404 rather than handing back an empty archive.
    assert client.get(f"/sessions/{created['id']}/poc").status_code == 404


@requires_postgres
def test_poc_files_and_zip_expose_the_generated_package(client, db_session) -> None:
    created = client.post("/sessions", json={"user_id": "poc-user", "title": "PoC"}).json()
    session_id = created["id"]
    _write_poc(_session_output_dir(db_session, session_id))

    listed = client.get(f"/sessions/{session_id}/poc/files").json()
    assert listed["generated"] is True
    assert listed["files"] == ["run.py", "schemas/output_schema.json"]

    got = client.get(f"/sessions/{session_id}/poc")
    assert got.status_code == 200
    assert got.headers["content-type"] == "application/zip"
    assert f"poc-{session_id}.zip" in got.headers["content-disposition"]

    # Entries keep the poc/ prefix so the archive unpacks into its own folder.
    with zipfile.ZipFile(io.BytesIO(got.content)) as zf:
        assert sorted(zf.namelist()) == ["poc/run.py", "poc/schemas/output_schema.json"]
        assert zf.read("poc/run.py") == b"print('poc')\n"


@requires_postgres
def test_poc_endpoints_404_for_an_unknown_session(client) -> None:
    missing = uuid.uuid4()
    assert client.get(f"/sessions/{missing}/poc/files").status_code == 404
    assert client.get(f"/sessions/{missing}/poc").status_code == 404
