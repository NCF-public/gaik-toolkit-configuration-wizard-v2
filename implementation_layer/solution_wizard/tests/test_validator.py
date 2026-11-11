"""Tests for BlueprintValidator (WP3)."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from solution_wizard.blueprint import (
    Artifact,
    ArtifactSource,
    Blueprint,
    Components,
    SelectedModule,
    UseCase,
    Workflow,
    WorkflowStep,
)
from solution_wizard.validator import validate

EXAMPLES = Path(__file__).parent.parent / "examples"


def _base_blueprint(**overrides) -> Blueprint:
    data = dict(
        use_case=UseCase(id="test", name="Test", description="Test", domain="test"),
        artifacts={
            "input_audio": Artifact(
                type="audio", source=ArtifactSource.USER_UPLOAD, optional=False
            ),
            "transcript": Artifact(
                type="transcript",
                source=ArtifactSource.GENERATED,
                optional=False,
                produced_by="step_a",
                final_output=True,
            ),
        },
        components=Components(selected_building_blocks=["Transcriber"]),
        workflow=Workflow(
            steps=[
                WorkflowStep(
                    id="step_a",
                    name="Transcribe",
                    type="automated_task",
                    component="Transcriber",
                    inputs=["input_audio"],
                    outputs=["transcript"],
                ),
            ]
        ),
    )
    data.update(overrides)
    return Blueprint(**data)


# ---------------------------------------------------------------------------
# Examples pass
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "filename",
    [
        "incident_reporting_blueprint.json",
        "document_extraction_blueprint.json",
        "rag_workflow_blueprint.json",
    ],
)
def test_example_blueprints_validate(filename):
    bp = Blueprint.from_file(EXAMPLES / filename)
    result = validate(bp)
    assert result.ok, result.summary()


# ---------------------------------------------------------------------------
# Rule 1: unique step IDs
# ---------------------------------------------------------------------------


def test_rule1_duplicate_step_id():
    bp = _base_blueprint(
        workflow=Workflow(
            steps=[
                WorkflowStep(
                    id="step_a",
                    name="A",
                    type="automated_task",
                    component="Transcriber",
                    inputs=["input_audio"],
                    outputs=["transcript"],
                ),
                WorkflowStep(
                    id="step_a",
                    name="A dup",
                    type="automated_task",
                    component="Transcriber",
                    inputs=["input_audio"],
                    outputs=["transcript"],
                ),
            ]
        )
    )
    result = validate(bp)
    assert not result.ok
    assert any(e.rule == 1 for e in result.errors)


# ---------------------------------------------------------------------------
# Rule 2: undeclared artifact reference
# ---------------------------------------------------------------------------


def test_rule2_undeclared_artifact():
    bp = _base_blueprint(
        workflow=Workflow(
            steps=[
                WorkflowStep(
                    id="step_a",
                    name="A",
                    type="automated_task",
                    component="Transcriber",
                    inputs=["nonexistent_artifact"],
                    outputs=["transcript"],
                ),
            ]
        )
    )
    result = validate(bp)
    assert not result.ok
    assert any(e.rule == 2 for e in result.errors)


# ---------------------------------------------------------------------------
# Rule 3: unknown component
# ---------------------------------------------------------------------------


def test_rule3_unknown_component():
    bp = _base_blueprint(
        workflow=Workflow(
            steps=[
                WorkflowStep(
                    id="step_a",
                    name="A",
                    type="automated_task",
                    component="GhostComponent",
                    inputs=["input_audio"],
                    outputs=["transcript"],
                ),
            ]
        )
    )
    result = validate(bp)
    assert not result.ok
    assert any(e.rule == 3 for e in result.errors)


# ---------------------------------------------------------------------------
# Rule 7: artifact consumed before produced
# ---------------------------------------------------------------------------


def test_rule7_consume_before_produce():
    bp = Blueprint(
        use_case=UseCase(id="t", name="T", description="T", domain="t"),
        artifacts={
            "src": Artifact(type="audio", source=ArtifactSource.USER_UPLOAD, optional=False),
            "mid": Artifact(
                type="text", source=ArtifactSource.GENERATED, optional=False, produced_by="step_b"
            ),
            "out": Artifact(
                type="structured_json",
                source=ArtifactSource.GENERATED,
                optional=False,
                produced_by="step_a",
                final_output=True,
            ),
        },
        workflow=Workflow(
            steps=[
                # step_a consumes 'mid' which is produced by step_b (later)
                WorkflowStep(
                    id="step_a",
                    name="A",
                    type="automated_task",
                    component="Extractor",
                    inputs=["mid"],
                    outputs=["out"],
                ),
                WorkflowStep(
                    id="step_b",
                    name="B",
                    type="automated_task",
                    component="Transcriber",
                    inputs=["src"],
                    outputs=["mid"],
                ),
            ]
        ),
    )
    result = validate(bp)
    assert not result.ok
    assert any(e.rule == 7 for e in result.errors)


# ---------------------------------------------------------------------------
# Rule 8: cycle detection
# ---------------------------------------------------------------------------


def test_rule8_cycle_detected():
    bp = Blueprint(
        use_case=UseCase(id="t", name="T", description="T", domain="t"),
        artifacts={
            "a": Artifact(type="audio", source=ArtifactSource.USER_UPLOAD, optional=False),
            "b": Artifact(
                type="text",
                source=ArtifactSource.GENERATED,
                optional=False,
                produced_by="step_a",
                final_output=True,
            ),
        },
        workflow=Workflow(
            steps=[
                WorkflowStep(
                    id="step_a",
                    name="A",
                    type="automated_task",
                    component="Transcriber",
                    inputs=["a"],
                    outputs=["b"],
                    depends_on=["step_b"],
                ),
                WorkflowStep(
                    id="step_b",
                    name="B",
                    type="automated_task",
                    component="Transcriber",
                    inputs=["a"],
                    outputs=["b"],
                    depends_on=["step_a"],
                ),
            ]
        ),
    )
    result = validate(bp)
    assert not result.ok
    assert any(e.rule == 8 for e in result.errors)


# ---------------------------------------------------------------------------
# Rule 7b: produced_by must match step.outputs (crosscheck)
# ---------------------------------------------------------------------------


def test_rule7_produced_by_not_in_step_outputs():
    """Artifact claims produced_by a step that doesn't list it in outputs."""
    bp = Blueprint(
        use_case=UseCase(id="t", name="T", description="T", domain="t"),
        artifacts={
            "src": Artifact(type="audio", source=ArtifactSource.USER_UPLOAD, optional=False),
            "out": Artifact(
                type="text",
                source=ArtifactSource.GENERATED,
                optional=False,
                produced_by="step_a",  # step_a outputs "other_thing", not "out"
                final_output=True,
            ),
            "other_thing": Artifact(
                type="text",
                source=ArtifactSource.GENERATED,
                optional=False,
                produced_by="step_a",
                final_output=False,
            ),
        },
        workflow=Workflow(
            steps=[
                WorkflowStep(
                    id="step_a",
                    name="A",
                    type="automated_task",
                    component="Transcriber",
                    inputs=["src"],
                    outputs=["other_thing"],  # does NOT include "out"
                ),
            ]
        ),
    )
    result = validate(bp)
    assert not result.ok
    assert any(e.rule == 7 and "out" in e.message for e in result.errors)


# ---------------------------------------------------------------------------
# Rule 9: no final output
# ---------------------------------------------------------------------------


def test_rule9_no_final_output():
    bp = Blueprint(
        use_case=UseCase(id="t", name="T", description="T", domain="t"),
        artifacts={
            "src": Artifact(type="audio", source=ArtifactSource.USER_UPLOAD, optional=False),
            "out": Artifact(
                type="text",
                source=ArtifactSource.GENERATED,
                optional=False,
                produced_by="step_a",
                final_output=False,
            ),
        },
        workflow=Workflow(
            steps=[
                WorkflowStep(
                    id="step_a",
                    name="A",
                    type="automated_task",
                    component="Transcriber",
                    inputs=["src"],
                    outputs=["out"],
                ),
            ]
        ),
    )
    result = validate(bp)
    assert not result.ok
    assert any(e.rule == 9 for e in result.errors)


# ---------------------------------------------------------------------------
# Rule 12: redundant subsumed sub-component (warning, non-blocking) -- V3
# ---------------------------------------------------------------------------


def _audio_enhance_data(separate_enhancer: bool) -> dict:
    steps = [
        {
            "id": "transcribe",
            "name": "Transcribe",
            "type": "automated_task",
            "component": "Transcriber",
            "inputs": ["src_audio"],
            "outputs": ["raw_transcript"],
        },
    ]
    artifacts = {
        "src_audio": {"type": "audio", "source": "user_upload", "optional": False},
        "raw_transcript": {
            "type": "transcript",
            "source": "generated",
            "optional": False,
            "produced_by": "transcribe",
            "final_output": not separate_enhancer,
        },
    }
    blocks = ["Transcriber"]
    if separate_enhancer:
        steps.append(
            {
                "id": "enhance",
                "name": "Enhance",
                "type": "automated_task",
                "component": "TranscriptEnhancer",
                "inputs": ["raw_transcript"],
                "outputs": ["enh_transcript"],
                "depends_on": ["transcribe"],
            }
        )
        artifacts["enh_transcript"] = {
            "type": "enhanced_transcript",
            "source": "generated",
            "optional": False,
            "produced_by": "enhance",
            "final_output": True,
        }
        blocks.append("TranscriptEnhancer")
    return {
        "blueprint_version": "1.0",
        "use_case": {"id": "audio_uc", "name": "Audio", "description": "x", "domain": "test"},
        "components": {
            "selected_modules": [],
            "selected_building_blocks": blocks,
            "custom_components": [],
        },
        "artifacts": artifacts,
        "workflow": {"steps": steps},
    }


def test_redundant_transcript_enhancer_warns_but_does_not_block():
    bp = Blueprint.model_validate(_audio_enhance_data(separate_enhancer=True))
    result = validate(bp)
    rule12 = [w for w in result.warnings if w.rule == 12]
    assert rule12, "expected a Rule-12 redundancy warning"
    assert any("TranscriptEnhancer" in w.message for w in rule12)
    assert result.ok, "redundancy is a warning, not a blocking error"


def test_no_redundancy_warning_for_single_transcriber():
    bp = Blueprint.model_validate(_audio_enhance_data(separate_enhancer=False))
    result = validate(bp)
    assert not [w for w in result.warnings if w.rule == 12]


# ---------------------------------------------------------------------------
# Rule 13: declared hallucination check must receive grounding evidence
# ---------------------------------------------------------------------------


def _judge_blueprint(judge_inputs, hallucination_check=True) -> Blueprint:
    """Transcribe -> extract -> LLMJudge, with the judge's inputs parameterised."""
    return _base_blueprint(
        artifacts={
            "input_audio": Artifact(
                type="audio", source=ArtifactSource.USER_UPLOAD, optional=False
            ),
            "transcript": Artifact(
                type="transcript",
                source=ArtifactSource.GENERATED,
                optional=False,
                produced_by="step_a",
            ),
            "extracted": Artifact(
                type="structured_json",
                source=ArtifactSource.GENERATED,
                optional=False,
                produced_by="step_b",
                final_output=True,
            ),
            "report": Artifact(
                type="validation_report",
                source=ArtifactSource.GENERATED,
                optional=False,
                produced_by="step_c",
            ),
        },
        components=Components(selected_building_blocks=["Transcriber", "Extractor", "LLMJudge"]),
        workflow=Workflow(
            steps=[
                WorkflowStep(
                    id="step_a",
                    name="Transcribe",
                    type="automated_task",
                    component="Transcriber",
                    inputs=["input_audio"],
                    outputs=["transcript"],
                ),
                WorkflowStep(
                    id="step_b",
                    name="Extract",
                    type="automated_task",
                    component="Extractor",
                    inputs=["transcript"],
                    outputs=["extracted"],
                    depends_on=["step_a"],
                ),
                WorkflowStep(
                    id="step_c",
                    name="Validate",
                    type="automated_task",
                    component="LLMJudge",
                    inputs=judge_inputs,
                    outputs=["report"],
                    depends_on=["step_b"],
                ),
            ]
        ),
        validation={"hallucination_check": hallucination_check},
    )


def test_rule13_judge_without_grounding_input_is_an_error():
    """Dropping the source artifact must not pass silently."""
    result = validate(_judge_blueprint(["extracted"]))
    assert not result.ok
    assert any(e.rule == 13 and e.step_id == "step_c" for e in result.errors)


def test_rule13_judge_with_grounding_input_passes():
    result = validate(_judge_blueprint(["transcript", "extracted"]))
    assert not [e for e in result.errors if e.rule == 13]


def test_rule13_not_applied_when_hallucination_check_is_off():
    result = validate(_judge_blueprint(["extracted"], hallucination_check=False))
    assert not [e for e in result.errors if e.rule == 13]


def test_rule13_warns_when_check_declared_but_no_validator_step():
    result = validate(_base_blueprint(validation={"hallucination_check": True}))
    assert any(w.rule == 13 for w in result.warnings)


# ---------------------------------------------------------------------------
# Rule 14: model providers agree with the governance flags
# ---------------------------------------------------------------------------


def _governed(models: dict, *, external: bool = False, local: bool = False) -> Blueprint:
    bp = Blueprint.from_file(EXAMPLES / "incident_reporting_blueprint.json")
    bp.governance.data_handling.external_model_api_allowed = external
    bp.governance.data_handling.local_processing_required = local
    bp.models = models
    return bp


def _rule14(result):
    return [e for e in result.errors if e.rule == 14], [w for w in result.warnings if w.rule == 14]


def test_rule14_default_flags_allow_any_provider():
    bp = Blueprint.from_file(EXAMPLES / "incident_reporting_blueprint.json")
    bp.models = {"provider": "azure"}
    assert _rule14(validate(bp)) == ([], [])


def test_rule14_hosted_provider_contradicts_no_external_api():
    errors, _ = _rule14(validate(_governed({"provider": "openai"})))
    assert len(errors) == 1 and "models.provider is 'openai'" in errors[0].message


def test_rule14_unset_provider_is_not_left_to_the_hosted_default():
    errors, _ = _rule14(validate(_governed({}, external=True, local=True)))
    assert len(errors) == 1 and "not set" in errors[0].message


def test_rule14_stage_override_is_checked_too():
    models = {
        "provider": "openai_compatible",
        "base_url": "http://localhost:8000/v1",
        "judge_config": {"provider": "anthropic"},
    }
    errors, warnings = _rule14(validate(_governed(models)))
    assert len(errors) == 1
    assert "models.judge_config.provider is 'anthropic'" in errors[0].message
    assert any("base_url" in w.message for w in warnings)


def test_rule14_local_whisper_still_needs_a_self_hosted_provider_for_enhancement():
    """Transcript enhancement sends the transcript to the stage's chat API."""
    hosted = {
        "provider": "openai_compatible",
        "transcription_config": {"provider": "azure", "transcription_model": "whisper_local"},
    }
    errors, _ = _rule14(validate(_governed(hosted)))
    assert len(errors) == 1
    assert "models.transcription_config.provider is 'azure'" in errors[0].message

    local = {
        "provider": "openai_compatible",
        "transcription_config": {
            "provider": "openai_compatible",
            "transcription_model": "whisper_local",
        },
    }
    errors, warnings = _rule14(validate(_governed(local)))
    assert errors == [] and warnings


def test_rule14_blank_provider_counts_as_unset():
    errors, _ = _rule14(validate(_governed({"provider": "  "})))
    assert len(errors) == 1 and "not set" in errors[0].message


# ---------------------------------------------------------------------------
# Size limits
# ---------------------------------------------------------------------------


def _chain(n: int, close_loop: bool = False) -> list[WorkflowStep]:
    steps = [
        WorkflowStep(
            id=f"s{i}",
            name=f"S{i}",
            type="automated_task",
            depends_on=[f"s{i - 1}"] if i else ([f"s{n - 1}"] if close_loop else []),
        )
        for i in range(n)
    ]
    return steps


def test_rule8_long_dependency_chain_does_not_exhaust_recursion():
    """A chain longer than Python's recursion limit is checked without a crash."""
    from solution_wizard import blueprint as bp_mod

    n = sys.getrecursionlimit() + 50
    steps = _chain(n, close_loop=True)
    # Built without validation: the model itself would refuse this many steps.
    workflow = Workflow.model_construct(steps=steps)
    bp = Blueprint(use_case=UseCase(id="t", name="T", description="T", domain="t"))
    bp.workflow = workflow
    assert n > bp_mod.MAX_STEPS
    result = validate(bp)
    assert any(e.rule == 8 for e in result.errors)


def test_blueprint_refuses_too_many_steps():
    from pydantic import ValidationError

    from solution_wizard.blueprint import MAX_STEPS

    data = {
        "use_case": {"id": "t", "name": "T", "description": "T", "domain": "t"},
        "workflow": {"steps": [s.model_dump() for s in _chain(MAX_STEPS)]},
    }
    Blueprint.model_validate(data)
    data["workflow"]["steps"].append(_chain(MAX_STEPS + 1)[-1].model_dump())
    with pytest.raises(ValidationError):
        Blueprint.model_validate(data)


def test_blueprint_refuses_oversized_json():
    from pydantic import ValidationError

    from solution_wizard.blueprint import MAX_BLUEPRINT_CHARS

    data = {
        "use_case": {
            "id": "t",
            "name": "T",
            "description": "x" * MAX_BLUEPRINT_CHARS,
            "domain": "t",
        },
    }
    with pytest.raises(ValidationError, match="the limit is"):
        Blueprint.model_validate(data)


def test_example_blueprints_fit_the_limits():
    for path in sorted(EXAMPLES.glob("*blueprint*.json")):
        Blueprint.from_file(path)


def test_blueprint_size_counts_characters_not_escapes():
    """Non-ASCII text counts once per character, as the limit says."""
    from solution_wizard.blueprint import MAX_BLUEPRINT_CHARS

    text = "ä" * (MAX_BLUEPRINT_CHARS // 2)
    Blueprint.model_validate(
        {"use_case": {"id": "t", "name": "T", "description": text, "domain": "t"}}
    )
