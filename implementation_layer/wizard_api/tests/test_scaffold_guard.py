"""The scaffolder gets blueprint text it can place in source as plain text.

Quotes, backslashes and line breaks in descriptions and names are replaced so
they stay inside their string literals, names that become identifiers must be
identifiers, and model endpoints must be a provider's own or come from the
environment.
"""

import ast
import json
import os

import pytest
from wizard_api.services import artifact_sync, poc_service, scaffold_guard

requires_scaffolder = pytest.mark.skipif(
    not poc_service.solution_wizard_available(),
    reason="solution_wizard is not installed",
)


def _blueprint(marker: str, **overrides) -> dict:
    # If any of these values were not kept as text, the marker file would appear.
    sample = f'x"); open({marker!r}, "w"); _z=("'
    blueprint = {
        "use_case": {
            "id": "uc",
            "name": f"Tickets PoC{sample}",
            "description": f'Docstring breaker """ {sample}\\',
            "domain": "maintenance",
        },
        "technical_spec": {"input_types": ["pdf"], "language": f"fi{sample}"},
        "target_output_spec": {
            "schema_name": "Ticket",
            "fields": ["asset", "urgency"],
            "field_types": {"asset": "str", "urgency": "str"},
            "field_descriptions": {"asset": f"Asset id{sample}", "urgency": "Line one\nline two"},
            "allowed_values": {"urgency": ["low", f"high{sample}"]},
        },
        "components": {
            "selected_modules": [
                {"id": "documents_to_structured_data", "name": "documents_to_structured_data"}
            ],
            "selected_building_blocks": [],
        },
    }
    blueprint.update(overrides)
    return blueprint


def _scaffold(tmp_path, blueprint: dict) -> dict:
    path = artifact_sync.artifact_path(str(tmp_path), artifact_sync.DRAFT_BLUEPRINT_FILE)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(blueprint, fh)
    return poc_service.generate_poc(
        {"use_case": {"title": "Guarded"}}, session_id="guard", output_dir=str(tmp_path)
    )


@requires_scaffolder
def test_blueprint_text_stays_text_when_the_poc_is_generated(tmp_path) -> None:
    marker = str(tmp_path / "marker")

    result = _scaffold(tmp_path, _blueprint(marker))

    assert result["source"] == "scaffolder"
    assert not os.path.exists(marker)
    # The schema module is executed here and run_poc.py in the sandbox; neither
    # may contain the sample as code. (evals/run_basic_eval.py does not parse
    # even for a clean blueprint, a V1 template issue outside this guard.)
    for name in ("schemas/output_schema.py", "run_poc.py"):
        tree = ast.parse((tmp_path / "poc" / name).read_text(encoding="utf-8"))
        as_code = [
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.Call)
            and any(isinstance(a, ast.Constant) and a.value == marker for a in n.args)
        ]
        assert as_code == [], name


@requires_scaffolder
def test_the_wording_survives_without_the_characters_that_end_a_literal(tmp_path) -> None:
    _scaffold(tmp_path, _blueprint(str(tmp_path / "marker")))
    schema = open(tmp_path / "poc" / "schemas" / "output_schema.py", encoding="utf-8").read()

    assert "Asset idx”)" in schema
    assert "Line one line two" in schema


@requires_scaffolder
@pytest.mark.parametrize(
    "where, value",
    [
        ("field", "asset = 1; import os  #"),
        ("field", "asset-id"),
        ("schema_name", "Ticket(BaseModel): pass\nclass X"),
        ("eval_framework", "{__import__('os').getpid()}"),
        ("step", "extract\nimport os"),
    ],
)
def test_a_name_that_is_not_an_identifier_is_refused(tmp_path, where, value) -> None:
    blueprint = _blueprint(str(tmp_path / "marker"))
    spec = blueprint["target_output_spec"]
    if where == "field":
        spec["fields"] = [value, "urgency"]
    elif where == "schema_name":
        spec["schema_name"] = value
    elif where == "eval_framework":
        blueprint["evaluation"] = {"eval_framework": value}
    else:
        blueprint["workflow"] = {
            "steps": [{"id": value, "name": "Extract", "type": "automated_task"}]
        }

    with pytest.raises(poc_service.UnscaffoldableBlueprintError) as exc:
        _scaffold(tmp_path, blueprint)
    assert repr(value) in str(exc.value)
    assert not (tmp_path / "poc").exists()


def test_a_clean_blueprint_is_handed_on_unchanged() -> None:
    blueprint = {
        "use_case": {"id": "uc01-voice", "name": "Fault reports", "description": "Voice → ticket"},
        "target_output_spec": {
            "schema_name": "MaintenanceTicket",
            "fields": ["asset_identifier", "määrä"],
            "allowed_values": {"line_items.product_form": ["bar"]},
            "nested": {"määrä": {"fields": ["value"]}},
        },
        "workflow": {"steps": [{"id": "extract", "inputs": ["audio"], "outputs": ["ticket"]}]},
        "evaluation": {"eval_framework": "RAG_eval"},
    }

    assert scaffold_guard.problems(blueprint) == []
    assert scaffold_guard.safe_for_scaffolding(blueprint) == blueprint


@pytest.mark.parametrize(
    "models",
    [
        {"extraction_config": {"provider": "azure", "azure_endpoint": "https://other.example/"}},
        {"base_url": "https://my-resource.openai.azure.com.other.example/v1"},
        {"extraction_config": {"provider": "openai", "base_url": "http://api.openai.com/v1"}},
        {"extraction_config": {"provider": "azure", "model": "env:AZURE_API_KEY"}},
        {"judge_config": {"provider": "azure", "api_version": "env:WIZARD_DATABASE_URL"}},
        {"extraction_config": {"provider": "openai_compatible", "base_url": "env:AZURE_API_KEY"}},
        {"extraction_config": {"provider": "azure", "resource": "x.other.example/"}},
    ],
)
def test_models_name_a_provider_endpoint_and_settings_only(models) -> None:
    assert scaffold_guard.problems({"models": models})


def test_provider_endpoints_and_env_endpoints_are_allowed() -> None:
    models = {
        "provider": "azure",
        "azure_endpoint": "https://my-resource.openai.azure.com/",
        "extraction_config": {"provider": "azure", "model": "env:EXTRACTION_DEPLOYMENT"},
        "answer_config": {"provider": "openai_compatible", "base_url": "env:LOCAL_LLM_BASE_URL"},
        "judge_config": {"provider": "aitta", "base_url": "https://aitta-api.csc.fi/openai/v1"},
        "embedding_config": {"provider": "azure", "resource": "my-resource"},
    }

    assert scaffold_guard.problems({"models": models}) == []
