"""The preflight script, run the way the Job runs it: ``python -c`` in the package dir (#252)."""

import subprocess
import sys
from pathlib import Path

import pytest
from wizard_api.services.preflight_script import PREFLIGHT_SCRIPT

pytest.importorskip("yaml")


def _run(poc: Path):
    return subprocess.run(
        [sys.executable, "-c", PREFLIGHT_SCRIPT],
        cwd=poc,
        capture_output=True,
        text=True,
        timeout=60,
    )


def _package(tmp_path: Path, source: str) -> Path:
    poc = tmp_path / "poc"
    poc.mkdir()
    (poc / "run_poc.py").write_text(source)
    return poc


def test_a_package_that_imports_cleanly_passes(tmp_path):
    result = _run(_package(tmp_path, "import json\nfrom pathlib import Path\n"))

    assert result.returncode == 0, result.stdout
    assert "=== PREFLIGHT OK ===" in result.stdout


def test_a_syntax_error_is_reported_with_its_line(tmp_path):
    result = _run(_package(tmp_path, "import json\ndef main(:\n    pass\n"))

    assert result.returncode == 1
    assert "PROBLEM: run_poc.py does not parse (line 2" in result.stdout
    assert "=== PREFLIGHT FAILED: 1 problem(s) ===" in result.stdout


def test_a_module_the_image_lacks_is_reported_with_the_exception(tmp_path):
    result = _run(_package(tmp_path, "import json\nimport a_module_nobody_has\n"))

    assert result.returncode == 1
    assert "line 2: import a_module_nobody_has failed (ModuleNotFoundError" in result.stdout


def test_a_name_the_module_does_not_have_is_reported(tmp_path):
    result = _run(_package(tmp_path, "from yaml import safe_load, nothing_like_this\n"))

    assert result.returncode == 1
    assert "yaml has no name nothing_like_this" in result.stdout


def test_a_guarded_optional_import_and_a_local_module_do_not_fail_it(tmp_path):
    poc = _package(
        tmp_path,
        "import helper\ntry:\n    import some_optional_thing\nexcept ImportError:\n    pass\n",
    )
    (poc / "helper.py").write_text("x = 1\n")

    assert _run(poc).returncode == 0


def test_a_stage_whose_config_cannot_be_built_is_named(tmp_path):
    poc = _package(tmp_path, "import json\n")
    (poc / "config.yaml").write_text("stages:\n  extraction:\n    provider: nowhere\n")
    (poc / "provider_config.py").write_text(
        "def get_stage_config(config, stage):\n    raise ValueError('no key for ' + stage)\n"
    )

    result = _run(poc)

    assert result.returncode == 1
    assert (
        "PROBLEM: config.yaml stage extraction: ValueError: no key for extraction" in result.stdout
    )


def test_a_stage_that_builds_passes(tmp_path):
    poc = _package(tmp_path, "import json\n")
    (poc / "config.yaml").write_text("stages:\n  extraction:\n    provider: azure\n")
    (poc / "provider_config.py").write_text(
        "def get_stage_config(config, stage):\n    return {'provider': 'azure'}\n"
    )

    assert _run(poc).returncode == 0
