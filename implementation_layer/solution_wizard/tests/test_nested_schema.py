"""Repeated child records survive schema generation (Akseli's R7).

A purchase order's line items became a single text field, and the row fields
were flattened into the parent as scalars — so the schema could not represent
more than one row, which is exactly what the use case requires.

The cause was in this module: `dict` and `object` mapped to `str` with the note
"Until then the field is typed as str so the PoC at least parses", because Azure
OpenAI's structured output rejects a bare dict. The fix the note asks for is a
named sub-model with extra='forbid', and gaik's own requirements format has
carried the nested shape all along — `CompositeExtractionRequirements` — so
nothing outside the wizard had to change.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from solution_wizard.schema_designer import (  # noqa: E402
    _child_model_name,
    build_pydantic_model,
    build_requirements_json,
)

PO_SPEC = {
    "schema_name": "PurchaseOrder",
    "fields": ["po_number", "supplier_name", "line_items", "total_amount"],
    "field_types": {"total_amount": "decimal"},
    "required_fields": ["po_number", "line_items"],
    "field_descriptions": {"line_items": "One entry per order line"},
    "nested": {
        "line_items": {
            "fields": ["item_number", "article_code", "quantity", "unit_price"],
            "field_types": {"item_number": "int", "quantity": "int", "unit_price": "decimal"},
            "required_fields": ["item_number", "quantity"],
        }
    },
}

FLAT_SPEC = {
    "schema_name": "IncidentReport",
    "fields": ["incident_date", "location", "severity"],
    "required_fields": ["incident_date"],
}


def _model(spec, name=None):
    namespace: dict = {}
    exec(compile(build_pydantic_model(spec, name), "output_schema.py", "exec"), namespace)
    return namespace


# ---------------------------------------------------------------------------
# Naming
# ---------------------------------------------------------------------------


def test_the_child_class_is_named_after_one_row():
    assert _child_model_name("line_items") == "LineItem"
    assert _child_model_name("invoice_rows") == "InvoiceRow"
    assert _child_model_name("participants") == "Participant"


def test_a_container_that_is_already_singular_keeps_its_name():
    assert _child_model_name("address") == "Address"


def test_an_ies_plural_becomes_a_y_singular():
    assert _child_model_name("delivery_entries") == "DeliveryEntry"


# ---------------------------------------------------------------------------
# The generated model
# ---------------------------------------------------------------------------


def test_the_generated_module_is_valid_python_and_builds_the_models():
    ns = _model(PO_SPEC)

    assert "PurchaseOrder" in ns
    assert "LineItem" in ns


def test_many_rows_survive_where_one_text_field_used_to_be():
    """R7 itself: the case needs as many rows as the document has."""
    ns = _model(PO_SPEC)

    po = ns["PurchaseOrder"](
        po_number="PO-1",
        line_items=[
            {"item_number": 1, "quantity": 5, "unit_price": "12.50"},
            {"item_number": 2, "quantity": 3, "article_code": "A-9"},
        ],
    )

    assert len(po.line_items) == 2
    assert po.line_items[0].quantity == 5
    assert po.line_items[1].article_code == "A-9"


def test_the_row_fields_are_not_flattened_into_the_parent():
    ns = _model(PO_SPEC)

    assert "quantity" not in ns["PurchaseOrder"].model_fields
    assert "quantity" in ns["LineItem"].model_fields


def test_every_object_forbids_extra_properties():
    """Azure's structured output requires additionalProperties:false on every
    object in the schema — the constraint that made `str` the stand-in."""
    schema = _model(PO_SPEC)["PurchaseOrder"].model_json_schema()

    assert schema["additionalProperties"] is False
    assert schema["$defs"]["LineItem"]["additionalProperties"] is False


def test_the_decimal_helper_is_emitted_once_even_when_both_levels_need_it():
    source = build_pydantic_model(PO_SPEC)

    assert source.count("def _clean_decimal_string") == 1


def test_a_flat_spec_generates_exactly_what_it_did_before():
    source = build_pydantic_model(FLAT_SPEC)

    assert "List[" not in source
    assert _model(FLAT_SPEC)["IncidentReport"](incident_date="2026-09-28")


def test_a_nested_block_for_an_unlisted_field_is_ignored():
    """A model nobody references is a spec error, not something to generate."""
    spec = dict(FLAT_SPEC, nested={"line_items": {"fields": ["a"]}})

    assert "LineItem" not in build_pydantic_model(spec)


# ---------------------------------------------------------------------------
# The runtime contract
# ---------------------------------------------------------------------------


def test_the_requirements_json_uses_the_nested_shape_gaik_already_reads():
    payload = build_requirements_json(PO_SPEC, use_case_name="Purchase orders")

    assert payload["requirements_type"] == "parent_with_nested_list"
    req = payload["requirements"]
    assert req["structure_type"] == "parent_with_nested_list"
    assert [f["field_name"] for f in req["parent_requirements"]["fields"]] == [
        "po_number",
        "supplier_name",
        "total_amount",
    ]
    child = req["children"][0]
    assert child["container_name"] == "line_items"
    assert [f["field_name"] for f in child["requirements"]["fields"]] == [
        "item_number",
        "article_code",
        "quantity",
        "unit_price",
    ]


def test_gaik_validates_the_generated_requirements():
    """The point of the shape: gaik's own model accepts it unchanged."""
    from gaik.software_components.extractor.schema import CompositeExtractionRequirements

    parsed = CompositeExtractionRequirements.model_validate(
        build_requirements_json(PO_SPEC)["requirements"]
    )

    assert parsed.children[0].container_name == "line_items"
    assert len(parsed.children[0].requirements.fields) == 4


def test_gaik_still_validates_a_flat_spec_the_old_way():
    from gaik.software_components.extractor.schema import ExtractionRequirements

    payload = build_requirements_json(FLAT_SPEC)

    assert "requirements_type" not in payload
    assert ExtractionRequirements.model_validate(payload["requirements"])
