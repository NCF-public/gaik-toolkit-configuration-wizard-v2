"""Template-level fixes: audio stage config, transcription format, schema defaults.

These run the generated helper code against stubs, so they need no gaik install.
"""

import json
import sys
import types
from pathlib import Path

import pytest

TEMPLATES = Path(__file__).parent.parent / "templates" / "poc"


@pytest.fixture
def provider_config(monkeypatch):
    def get_llm_config(provider, **settings):
        return {"provider": provider, **settings}

    llm = types.ModuleType("gaik.software_components.llm")
    llm.get_llm_config = get_llm_config
    providers = types.ModuleType("gaik.software_components.llm.providers")
    providers.resolve_provider = lambda name: name
    for name, mod in {
        "gaik": types.ModuleType("gaik"),
        "gaik.software_components": types.ModuleType("gaik.software_components"),
        "gaik.software_components.llm": llm,
        "gaik.software_components.llm.providers": providers,
    }.items():
        monkeypatch.setitem(sys.modules, name, mod)
    namespace: dict = {}
    source = (TEMPLATES / "_common" / "provider_config.py.tmpl").read_text(encoding="utf-8")
    exec(compile(source, "provider_config.py", "exec"), namespace)
    return types.SimpleNamespace(**namespace)


def test_audio_model_in_stage_model_goes_to_transcription_model(provider_config):
    config = {
        "stages": {
            "transcription": {"provider": "azure", "model": "gpt-4o-transcribe"},
            "extraction": {"provider": "azure", "model": "chat-model"},
        }
    }
    result = provider_config.get_stage_config(config, "transcription")
    assert result["transcription_model"] == "gpt-4o-transcribe"
    # the transcript enhancer calls chat completions with `model`: never the audio model
    assert result["model"] == "chat-model"


def test_transcription_stage_without_explicit_stage_uses_models_block(provider_config):
    config = {
        "provider": "azure",
        "models": {"transcription": "whisper", "extraction": "chat-model"},
    }
    result = provider_config.get_stage_config(config, "transcription")
    assert result["transcription_model"] == "whisper"
    assert result["model"] == "chat-model"


def test_chat_model_of_another_provider_is_not_borrowed(provider_config):
    config = {
        "stages": {
            "transcription": {"provider": "azure", "transcription_model": "whisper"},
            "extraction": {"provider": "anthropic", "model": "claude-x"},
        }
    }
    result = provider_config.get_stage_config(config, "transcription")
    assert "model" not in result


@pytest.mark.parametrize(
    "model,wanted,expected",
    [
        ("gpt-4o-transcribe", "srt", "text"),
        ("gpt-4o-transcribe", "vtt", "text"),
        ("gpt-4o-transcribe", "json", "json"),
        ("gpt-4o-transcribe", "text", "text"),
        ("whisper", "srt", "srt"),
        (None, "srt", "srt"),
    ],
)
def test_transcription_response_format(provider_config, model, wanted, expected):
    cfg = {"transcription_model": model}
    assert provider_config.transcription_response_format(cfg, wanted) == expected


@pytest.mark.parametrize("template", ["audio_to_structured", "document_to_structured"])
def test_non_string_field_default_is_reset_to_null(template, tmp_path, capsys):
    source = (TEMPLATES / template / "run_poc.py.tmpl").read_text(encoding="utf-8")
    start = source.index("def _normalise_field_defaults")
    end = source.index("def _load_schema_if_fresh")
    namespace = {"json": json, "Path": Path}
    exec(source[start:end], namespace)
    # the real file layout: gaik writes {"model_name", "requirements_type", "requirements": {...}}
    requirements = {
        "model_name": "Ticket",
        "requirements_type": "single",
        "requirements": {
            "use_case_name": "ticket",
            "fields": [
                {"field_name": "a", "default": "x", "has_explicit_default": True},
                {"field_name": "b", "default": [], "has_explicit_default": True},
                {"field_name": "c", "default": None, "has_explicit_default": False},
            ],
        },
    }
    path = tmp_path / "output_schema_requirements.json"
    path.write_text(json.dumps(requirements), encoding="utf-8")

    namespace["_normalise_field_defaults"](tmp_path, "output_schema")

    fields = json.loads(path.read_text(encoding="utf-8"))["requirements"]["fields"]
    assert fields[0]["default"] == "x" and fields[0]["has_explicit_default"] is True
    assert fields[1]["default"] is None and fields[1]["has_explicit_default"] is False
    assert fields[2]["default"] is None
    assert "WARNING" in capsys.readouterr().out


def test_missing_requirements_file_is_left_alone(tmp_path):
    source = (TEMPLATES / "audio_to_structured" / "run_poc.py.tmpl").read_text(encoding="utf-8")
    namespace = {"json": json, "Path": Path}
    exec(
        source[
            source.index("def _normalise_field_defaults") : source.index(
                "def _load_schema_if_fresh"
            )
        ],
        namespace,
    )
    namespace["_normalise_field_defaults"](tmp_path, "output_schema")
    assert list(tmp_path.iterdir()) == []
