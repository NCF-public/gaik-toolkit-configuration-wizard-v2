"""Tests for V2 blueprint adapter and BPMN sync."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from solution_wizard.blueprint import Blueprint
from solution_wizard.bpmn_generator import generate_bpmn
from solution_wizard.bpmn_sync import sync_v2_blueprint_from_bpmn_xml
from solution_wizard.v2_adapter import v2_to_v1_dict


def _sample_v2():
    return {
        "name": "Chatbot",
        "description": "Test",
        "goal": "Automate",
        "steps": [
            {"id": "input", "name": "User question", "type": "io", "description": "Ask"},
            {"id": "rag", "name": "RAG search", "type": "ai", "component": "pgvector"},
            {"id": "review", "name": "Human review", "type": "human_review"},
        ],
    }


def test_v2_to_v1_minimal_blueprint():
    v2 = _sample_v2()
    v1 = v2_to_v1_dict(v2, session_id="ses_test")
    bp = Blueprint.model_validate(v1)
    assert bp.use_case.name == "Chatbot"
    assert len(bp.workflow.steps) == 3
    assert bp.workflow.steps[0].type == "user_task"
    assert bp.workflow.steps[1].type == "automated_task"
    assert bp.artifacts  # synthesized data objects
    assert "pgvector" in bp.components.selected_building_blocks
    xml = generate_bpmn(bp)
    assert "<bpmn:definitions" in xml
    assert "User question" in xml
    # Official conventions: no custom caption suffixes; GenAI lane; descriptive events
    assert "[User input]" not in xml
    assert "GenAI" in xml
    assert "Started Chatbot" in xml
    assert "Chatbot completed" in xml
    assert "dataObjectReference" in xml


def test_v2_automated_task_uses_component_code_prefix():
    v2 = {
        "name": "Extract",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "up", "name": "Upload document", "type": "io"},
            {
                "id": "ex",
                "name": "Extract Structured Data",
                "type": "ai",
                "component": "DataExtractor",
            },
        ],
    }
    bp = Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s"))
    xml = generate_bpmn(bp)
    assert "[SE] Extract Structured Data" in xml
    assert "Upload document" in xml
    assert "[User input]" not in xml


def test_sync_updates_step_names_from_bpmn():
    v2 = {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "input", "name": "Old name", "type": "io"},
            {"id": "ai", "name": "AI step", "type": "ai"},
        ],
    }
    v1 = v2_to_v1_dict(v2, session_id="s1")
    xml = generate_bpmn(Blueprint.model_validate(v1))
    synced = sync_v2_blueprint_from_bpmn_xml(v2, xml.replace("Old name", "New label"))
    ids = [s["id"] for s in synced["steps"]]
    names = [s["name"] for s in synced["steps"]]
    assert ids == ["input", "ai"]
    assert "New label" in names
    assert len(synced["steps"]) == 2


def test_sync_removes_deleted_steps_and_keeps_order():
    v2 = {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "a", "name": "First", "type": "io"},
            {"id": "b", "name": "Middle", "type": "ai"},
            {"id": "c", "name": "Last", "type": "io"},
        ],
    }
    # Canvas with only a and c (b deleted): linear graph Start→a→c→End
    xml = """<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_1" targetNamespace="http://gaik.solutionwizard/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Started" />
    <bpmn:userTask id="Activity_a" name="First" />
    <bpmn:userTask id="Activity_c" name="Last" />
    <bpmn:endEvent id="EndEvent_success" name="Done" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Activity_a" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Activity_a" targetRef="Activity_c" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Activity_c" targetRef="EndEvent_success" />
  </bpmn:process>
</bpmn:definitions>
"""
    synced = sync_v2_blueprint_from_bpmn_xml(v2, xml)
    ids = [s["id"] for s in synced["steps"]]
    assert ids == ["a", "c"]
    assert synced["steps"][0]["type"] == "io"
    assert synced["steps"][1]["type"] == "io"


def test_sync_strips_component_code_prefix():
    v2 = {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "up", "name": "Upload", "type": "io"},
            {"id": "ex", "name": "Extract", "type": "ai", "component": "DataExtractor"},
        ],
    }
    xml = generate_bpmn(Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s")))
    synced = sync_v2_blueprint_from_bpmn_xml(v2, xml)
    by_id = {s["id"]: s for s in synced["steps"]}
    assert by_id["ex"]["name"] == "Extract"
    assert by_id["ex"]["type"] == "ai"


def test_data_objects_use_human_readable_labels():
    v2 = _sample_v2()
    bp = Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s"))
    xml = generate_bpmn(bp)
    assert 'name="User Question"' in xml
    assert 'name="Rag Search"' in xml
    assert 'name="Human Review"' in xml


def test_sync_updates_step_name_when_data_object_is_renamed():
    v2 = {
        "name": "Demo",
        "description": "",
        "goal": "",
        "steps": [
            {"id": "input", "name": "Syöte", "type": "io"},
            {"id": "ai", "name": "Generointi", "type": "ai"},
        ],
    }
    xml = generate_bpmn(Blueprint.model_validate(v2_to_v1_dict(v2, session_id="s")))
    edited = xml.replace(
        'id="DataObjectRef_sy_te" name="Sy Te"', 'id="DataObjectRef_sy_te" name="Syöte1"'
    )
    synced = sync_v2_blueprint_from_bpmn_xml(v2, edited)
    by_id = {s["id"]: s for s in synced["steps"]}
    assert by_id["input"]["name"] == "Syöte1"
    assert synced["data_objects"]["sy_te"] == "Syöte1"
