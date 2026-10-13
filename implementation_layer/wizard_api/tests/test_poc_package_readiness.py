"""A PoC package is only offered when it is one (customer test report, 19 / T8, R6).

The download appeared as soon as any file existed under ``poc/``, so a package
with no README, no requirements.txt and an entrypoint wiring nothing could be
taken away — and then did nothing when run. These tests pin what "complete"
means, using the two checks the reviewer named plus the two files the report
found missing.
"""

from pathlib import Path

from wizard_api.services.poc_service import package_is_ready, package_problems

WIRED_ENTRYPOINT = (
    "import sys\n"
    "from gaik.software_modules.audio_to_structured_data import AudioToStructuredData\n"
)
STUB_ENTRYPOINT = '"""TODO: wire the pipeline."""\n\nif __name__ == "__main__":\n    pass\n'


def _package(tmp_path: Path, *, entrypoint=WIRED_ENTRYPOINT, requirements="gaik[extract]\n",
             readme="# PoC\n") -> str:
    poc = tmp_path / "poc"
    poc.mkdir()
    if entrypoint is not None:
        (poc / "run_poc.py").write_text(entrypoint)
    if requirements is not None:
        (poc / "requirements.txt").write_text(requirements)
    if readme is not None:
        (poc / "README.md").write_text(readme)
    return str(poc)


def test_a_complete_package_is_ready(tmp_path):
    poc = _package(tmp_path)

    assert package_problems(poc) == []
    assert package_is_ready(poc)


def test_a_package_with_only_some_files_is_not_ready(tmp_path):
    """19: the download was live while the package was still only a few prompt
    and schema files."""
    poc = tmp_path / "poc"
    poc.mkdir()
    (poc / "schemas").mkdir()
    (poc / "schemas" / "output_schema.py").write_text("x = 1\n")

    problems = package_problems(str(poc))

    assert len(problems) == 3
    assert not package_is_ready(str(poc))


def test_an_entrypoint_that_wires_nothing_is_not_a_package(tmp_path):
    """The scaffolder's _generic fallback renders a TODO stub: the file exists,
    the package runs, and nothing happens."""
    problems = package_problems(_package(tmp_path, entrypoint=STUB_ENTRYPOINT))

    assert problems == ["run_poc.py does not wire any gaik component"]


def test_requirements_without_gaik_is_not_a_package(tmp_path):
    """Pertti's UC02 review: requirements.txt had no gaik at all, which makes
    the imports impossible."""
    problems = package_problems(_package(tmp_path, requirements="pydantic>=2\n"))

    assert problems == ["requirements.txt does not require gaik"]


def test_a_missing_readme_is_reported(tmp_path):
    problems = package_problems(_package(tmp_path, readme=None))

    assert problems == ["README.md is missing"]


def test_a_missing_entrypoint_is_reported(tmp_path):
    problems = package_problems(_package(tmp_path, entrypoint=None))

    assert problems == ["run_poc.py is missing"]


def test_every_problem_is_reported_not_just_the_first(tmp_path):
    """The user should learn what is wrong in one go, not one file per attempt."""
    problems = package_problems(
        _package(tmp_path, entrypoint=STUB_ENTRYPOINT, requirements="pydantic\n", readme=None)
    )

    assert len(problems) == 3
