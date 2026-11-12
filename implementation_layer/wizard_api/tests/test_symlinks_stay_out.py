"""Only the session's own regular files are listed, zipped or packaged.

A symlink in the session directory, to a file or a folder, is skipped wherever
the API lists, zips or reads the package.
"""

import os

from wizard_api.services import poc_service


def _tree(tmp_path):
    poc = tmp_path / "poc"
    (poc / "schemas").mkdir(parents=True)
    (poc / "run_poc.py").write_text("print('hi')\n")
    (poc / "schemas" / "output_schema.py").write_text("x = 1\n")
    outside_file = tmp_path / "outside" / "notes.txt"
    outside_file.parent.mkdir()
    outside_file.write_text("not part of the package")
    os.symlink(outside_file, poc / "linked.txt")
    os.symlink(outside_file.parent, poc / "linked_dir")
    os.symlink(poc / "run_poc.py", poc / "inner_link.py")  # even one pointing inside
    return poc, outside_file


def test_listing_skips_symlinked_files_and_folders(tmp_path) -> None:
    poc, _ = _tree(tmp_path)

    assert poc_service.regular_files(poc) == ["run_poc.py", "schemas/output_schema.py"]


def test_a_symlink_is_not_a_regular_file(tmp_path) -> None:
    poc, outside_file = _tree(tmp_path)

    assert poc_service.regular_file(poc / "run_poc.py", poc)
    assert not poc_service.regular_file(poc / "linked.txt", poc)
    assert not poc_service.regular_file(outside_file, poc)  # outside the root
    assert not poc_service.regular_file(poc / "linked_dir" / "notes.txt", poc)


def test_deployable_files_leave_symlinks_out(tmp_path) -> None:
    poc, _ = _tree(tmp_path)

    assert "linked.txt" not in poc_service.deployable_files(str(poc))
    assert not any(f.startswith("linked_dir") for f in poc_service.deployable_files(str(poc)))


def test_package_checks_do_not_read_through_a_symlink(tmp_path) -> None:
    poc, outside_file = _tree(tmp_path)
    (poc / "run_poc.py").unlink()
    os.symlink(outside_file, poc / "run_poc.py")

    assert "run_poc.py is missing" in poc_service.package_problems(str(poc))


def test_a_saved_run_is_not_read_through_a_linked_folder(tmp_path) -> None:
    from wizard_api.services import run_context

    session = tmp_path / "session"
    session.mkdir()
    elsewhere = tmp_path / "elsewhere" / "run-1"
    (elsewhere / "output").mkdir(parents=True)
    (elsewhere / "run.json").write_text('{"run_id": "run-1"}')
    (elsewhere / "output" / "result.json").write_text("{}")
    os.symlink(tmp_path / "elsewhere", session / "runs")  # runs/ itself is the link

    assert run_context.saved(str(session), "run-1") is None
    assert run_context.saved_output(str(session), "run-1") is None


def test_a_saved_run_skips_a_linked_output_folder(tmp_path) -> None:
    from wizard_api.services import run_context

    session = tmp_path / "session"
    run = session / "runs" / "run-1"
    run.mkdir(parents=True)
    (run / "run.json").write_text('{"run_id": "run-1"}')
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "result.json").write_text("{}")
    os.symlink(outside, run / "output")

    assert run_context.saved_output(str(session), "run-1") == ({}, {})


def test_an_input_is_not_removed_through_a_linked_input_folder(tmp_path) -> None:
    poc = tmp_path / "poc"
    poc.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "a.pdf").write_bytes(b"%PDF")
    os.symlink(outside, poc / poc_service.SAMPLE_INPUT_DIR)

    assert poc_service.delete_sample_input(str(poc), "a.pdf") is False
    assert (outside / "a.pdf").exists()
