"""The experimental Codex runner keeps the agent on Azure, in Codex's sandbox and
away from the user's own Codex setup (run_wizard_codex.py)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

pytest.importorskip("dotenv")
tomllib = pytest.importorskip("tomllib")

WIZARD = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WIZARD))

import run_wizard_codex as runner  # noqa: E402


def _config(tmp_path: Path, **overrides) -> dict:
    args = {
        "model": "gpt-6.2-sol",
        "effort": "medium",
        "base_url": "https://example.openai.azure.com/openai/v1",
        "output_dir": tmp_path / "out",
        "approval": "on-request",
    }
    args.update(overrides)
    return tomllib.loads(runner.codex_config(**args))


@pytest.mark.parametrize(
    ("endpoint", "expected"),
    [
        ("https://example.openai.azure.com/", "https://example.openai.azure.com/openai/v1"),
        ("https://example.openai.azure.com", "https://example.openai.azure.com/openai/v1"),
        # A path some tools keep in the endpoint is not doubled.
        ("https://example.openai.azure.com/openai/", "https://example.openai.azure.com/openai/v1"),
    ],
)
def test_the_base_url_is_the_resources_responses_api(endpoint, expected):
    assert runner.azure_base_url(endpoint) == expected


@pytest.mark.parametrize(
    "endpoint", ["", "example.openai.azure.com", "http://example.openai.azure.com/"]
)
def test_an_endpoint_that_is_not_https_is_refused(endpoint):
    with pytest.raises(ValueError):
        runner.azure_base_url(endpoint)


def test_the_config_sends_the_model_to_azure_with_the_env_key(tmp_path):
    config = _config(tmp_path)
    assert config["model"] == "gpt-6.2-sol"
    assert config["model_provider"] == "azure"
    provider = config["model_providers"]["azure"]
    assert provider["base_url"] == "https://example.openai.azure.com/openai/v1"
    assert provider["env_key"] == "AZURE_API_KEY"
    assert provider["wire_api"] == "responses"


def test_commands_write_only_in_the_sandbox_and_the_output_folder(tmp_path):
    config = _config(tmp_path)
    assert config["sandbox_mode"] == "workspace-write"
    workspace = config["sandbox_workspace_write"]
    assert workspace["writable_roots"] == [(tmp_path / "out").as_posix()]
    # The wizard's scripts and the PoC call the model.
    assert workspace["network_access"] is True


def test_the_repositorys_agents_md_is_not_loaded(tmp_path):
    assert _config(tmp_path)["project_doc_max_bytes"] == 0


def test_the_wizards_scripts_get_the_key_from_the_narrowed_environment(tmp_path):
    # Codex's default filter drops names with KEY in them, which the scripts need;
    # the runner has already narrowed the environment itself.
    policy = _config(tmp_path)["shell_environment_policy"]
    assert policy == {"inherit": "all", "ignore_default_excludes": True}


def test_the_users_own_skills_are_turned_off(tmp_path, monkeypatch):
    home = tmp_path / "home"
    for name in ("deploy", "media-gen"):
        (home / ".agents" / "skills" / name).mkdir(parents=True)
        (home / ".agents" / "skills" / name / "SKILL.md").write_text("---\nname: x\n---\n")
    (home / ".agents" / "skills" / "README.md").write_text("not a skill")
    monkeypatch.setattr(runner.Path, "home", classmethod(lambda cls: home))
    entries = _config(tmp_path)["skills"]["config"]
    assert entries == [
        {"path": (home / ".agents/skills/deploy/SKILL.md").as_posix(), "enabled": False},
        {"path": (home / ".agents/skills/media-gen/SKILL.md").as_posix(), "enabled": False},
    ]


def test_the_model_catalog_comes_from_a_signed_in_codex(tmp_path, monkeypatch):
    user_codex = tmp_path / "user-codex"
    user_codex.mkdir()
    entry = {"slug": "gpt-6.2-sol", "context_window": 500000}
    cache = {"models": [{"slug": "gpt-6-luna"}, entry], "identity": "not copied"}
    (user_codex / "models_cache.json").write_text(json.dumps(cache), encoding="utf-8")
    monkeypatch.setenv("CODEX_HOME", str(user_codex))
    home = tmp_path / "wizard-codex"
    home.mkdir()

    path = runner.write_model_catalog(home, "gpt-6.2-sol")

    assert json.loads(path.read_text(encoding="utf-8")) == {"models": [entry]}
    config = _config(tmp_path, catalog=path)
    assert config["model_catalog_json"] == path.as_posix()


@pytest.mark.parametrize(
    "cache", [None, "not json", json.dumps({"models": [{"slug": "gpt-6-luna"}]})]
)
def test_without_the_models_metadata_there_is_no_catalog(tmp_path, monkeypatch, cache):
    user_codex = tmp_path / "user-codex"
    user_codex.mkdir()
    if cache is not None:
        (user_codex / "models_cache.json").write_text(cache, encoding="utf-8")
    monkeypatch.setenv("CODEX_HOME", str(user_codex))
    assert runner.write_model_catalog(tmp_path, "my-sol-deployment") is None
    assert "model_catalog_json" not in _config(tmp_path)


def test_codexs_own_settings_stay_outside_the_output_folder(tmp_path):
    out = (tmp_path / "out").resolve()
    home = runner.codex_home_for(out)
    assert out not in home.parents and home != out
    assert runner.codex_home_for(out) == home  # the same folder for a resumed session
    assert runner.codex_home_for(tmp_path / "other") != home


def test_the_first_message_drops_the_claude_slash_command(tmp_path):
    pytest.importorskip("claude_agent_sdk")  # build_initial_prompt's module imports it
    message = runner.first_message(tmp_path / "out")
    assert not message.startswith("/")
    assert "./SKILL.md" in message
    assert (tmp_path / "out").as_posix() in message
