"""Symlinks in a session never pull other files into what the API hands out.

Security review (November 2026): everything under the session directory may be
written by the agent, and the PoC zip, the file listing and the deployable
package followed symlinks, so ``poc/x -> /proc/self/environ`` would have put the
API's own environment into the download.
"""

import os

from wizard_api.services import poc_service


def _tree(tmp_path):
    poc = tmp_path / "poc"
    (poc / "schemas").mkdir(parents=True)
    (poc / "run_poc.py").write_text("print('hi')\n")
    (poc / "schemas" / "output_schema.py").write_text("x = 1\n")
    secret = tmp_path / "outside" / "secret.txt"
    secret.parent.mkdir()
    secret.write_text("TOKEN=abc")
    os.symlink(secret, poc / "env.txt")
    os.symlink(secret.parent, poc / "linked_dir")
    os.symlink(poc / "run_poc.py", poc / "inner_link.py")  # even one pointing inside
    return poc, secret


def test_listing_skips_symlinked_files_and_folders(tmp_path) -> None:
    poc, _ = _tree(tmp_path)

    assert poc_service.regular_files(poc) == ["run_poc.py", "schemas/output_schema.py"]


def test_a_symlink_is_not_a_regular_file(tmp_path) -> None:
    poc, secret = _tree(tmp_path)

    assert poc_service.regular_file(poc / "run_poc.py", poc)
    assert not poc_service.regular_file(poc / "env.txt", poc)
    assert not poc_service.regular_file(secret, poc)  # outside the root
    assert not poc_service.regular_file(poc / "linked_dir" / "secret.txt", poc)


def test_deployable_files_leave_symlinks_out(tmp_path) -> None:
    poc, _ = _tree(tmp_path)

    assert "env.txt" not in poc_service.deployable_files(str(poc))
    assert not any(f.startswith("linked_dir") for f in poc_service.deployable_files(str(poc)))


def test_package_checks_do_not_read_through_a_symlink(tmp_path) -> None:
    poc, secret = _tree(tmp_path)
    (poc / "run_poc.py").unlink()
    os.symlink(secret, poc / "run_poc.py")

    assert "run_poc.py is missing" in poc_service.package_problems(str(poc))
