"""Unit tests for VisionExtractor's strict-schema conversion — no LLM calls.

These pin the two defects found on 23 Sep 2026 while running a generated PoC
against a real purchase order: a schema carrying a regex the strict-output
grammar cannot compile came back as an empty response with no error, and the
conversion never descended into anyOf branches, so nothing in them was ever
sanitised.
"""

import decimal

import pytest
from gaik.software_components.vision_extractor.vision_extractor import (
    _drop_uncompilable_patterns,
    _incomplete_with_no_output,
    _make_schema_strict,
    _supports_reasoning,
)
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Patterns the strict grammar cannot compile
# ---------------------------------------------------------------------------


def test_lookahead_pattern_is_dropped():
    """The exact pattern pydantic emits for a Decimal field."""
    node = {"type": "string", "pattern": r"^(?!^[-+.]*$)[+-]?0*\d*\.?\d*$"}
    assert "pattern" not in _drop_uncompilable_patterns(node)


@pytest.mark.parametrize(
    "pattern",
    [r"(?=x)", r"(?!x)", r"(?<=x)", r"(?<!x)", r"(a)\1"],
)
def test_every_unsupported_construct_is_dropped(pattern):
    assert "pattern" not in _drop_uncompilable_patterns({"type": "string", "pattern": pattern})


def test_ordinary_pattern_survives():
    """Only the uncompilable ones go — a plain anchor is still a useful constraint."""
    node = {"type": "string", "pattern": r"^[A-Z]{2}-\d{4}$"}
    assert _drop_uncompilable_patterns(node)["pattern"] == r"^[A-Z]{2}-\d{4}$"


def test_other_keys_are_untouched():
    node = {"type": "string", "pattern": r"(?!x)", "description": "keep me"}
    out = _drop_uncompilable_patterns(node)
    assert out["description"] == "keep me"
    assert out["type"] == "string"


# ---------------------------------------------------------------------------
# anyOf branches
# ---------------------------------------------------------------------------


class _Money(BaseModel):
    total_amount: decimal.Decimal | None = None


def test_a_decimal_field_leaves_no_uncompilable_pattern():
    """The regression: Decimal | None put the lookahead inside an anyOf branch."""
    import json

    strict = _make_schema_strict(_Money.model_json_schema())
    assert "(?!" not in json.dumps(strict)


def test_objects_inside_anyof_are_made_strict():
    schema = {
        "anyOf": [
            {"type": "object", "properties": {"a": {"type": "string"}}},
            {"type": "null"},
        ]
    }
    branch = _make_schema_strict(schema)["anyOf"][0]
    assert branch["additionalProperties"] is False
    assert branch["required"] == ["a"]


def test_nested_objects_and_arrays_are_still_made_strict():
    schema = {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {"type": "object", "properties": {"b": {"type": "string"}}},
            }
        },
    }
    out = _make_schema_strict(schema)
    assert out["additionalProperties"] is False
    assert out["properties"]["items"]["items"]["additionalProperties"] is False


def test_a_ref_keeps_no_sibling_keywords():
    out = _make_schema_strict({"$ref": "#/$defs/X", "description": "dropped"})
    assert out == {"$ref": "#/$defs/X"}


# ---------------------------------------------------------------------------
# Reasoning support
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("model", ["o1", "o3-mini", "o4-mini", "gpt-5", "gpt-5.4-mini"])
def test_reasoning_models_are_recognised(model):
    assert _supports_reasoning(model) is True


@pytest.mark.parametrize("model", ["gpt-4o", "gpt-4.1", "gpt-4o-mini", "gpt-4-turbo"])
def test_non_reasoning_models_are_not(model):
    """Sending reasoning to these is a hard 400, so they must not be matched."""
    assert _supports_reasoning(model) is False


# ---------------------------------------------------------------------------
# The empty-response shape
# ---------------------------------------------------------------------------


class _Usage:
    def __init__(self, output_tokens):
        self.output_tokens = output_tokens


class _Response:
    def __init__(self, status, output_tokens):
        self.status = status
        self.usage = _Usage(output_tokens)


def test_incomplete_with_no_output_is_recognised():
    assert _incomplete_with_no_output(_Response("incomplete", 0)) is True


def test_a_completed_response_is_not():
    assert _incomplete_with_no_output(_Response("completed", 120)) is False


def test_a_genuine_token_limit_is_not():
    """Ran out of budget after producing text — that is not the schema failure."""
    assert _incomplete_with_no_output(_Response("incomplete", 32768)) is False
