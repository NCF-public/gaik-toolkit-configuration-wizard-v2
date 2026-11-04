"""A regeneration touches only the package files its manifest names inside poc/.

The manifest sits in the session directory, which the agent can write, so an
entry that points outside the package is ignored rather than followed.
"""

import os

from wizard_api.services import poc_service


def _package(tmp_path):
    poc = tmp_path / "session" / "poc"
    poc.mkdir(parents=True)
    (poc / "run_poc.py").write_text("print('ours')\n", encoding="utf-8")
    outside = tmp_path / "other" / "use_case.blueprint.json"
    outside.parent.mkdir()
    outside.write_text("{}", encoding="utf-8")
    return poc, outside


def test_entries_outside_the_package_are_not_deleted(tmp_path) -> None:
    poc, outside = _package(tmp_path)
    os.symlink(outside, poc / "linked.json")
    manifest = {
        "files": [
            str(outside),
            "../../other/use_case.blueprint.json",
            "linked.json",
            7,
            "run_poc.py",
        ]
    }

    poc_service._clear_previous(poc, manifest)

    assert outside.exists()
    assert (poc / "linked.json").is_symlink()
    assert not (poc / "run_poc.py").exists()


def test_only_package_files_count_as_edited(tmp_path) -> None:
    poc, outside = _package(tmp_path)
    ours = poc_service._file_hash(poc / "run_poc.py")

    assert not poc_service._agent_edited(
        poc, {"hashes": {str(outside): "0" * 64, "run_poc.py": ours}}
    )
    assert poc_service._agent_edited(poc, {"hashes": {"run_poc.py": "0" * 64}})


def test_a_manifest_of_the_wrong_shape_changes_nothing(tmp_path) -> None:
    poc, _ = _package(tmp_path)

    poc_service._clear_previous(poc, {"files": "run_poc.py"})
    assert not poc_service._agent_edited(poc, {"hashes": ["run_poc.py"]})
    assert (poc / "run_poc.py").exists()
