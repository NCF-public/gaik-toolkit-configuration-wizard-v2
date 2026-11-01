"""Keeps blueprint text from becoming code when the V1 scaffolder writes a PoC.

The scaffolder pastes blueprint values into Python source: field and step ids
become identifiers, descriptions and names go between double quotes, and the
schema module it writes is executed in this process to export JSON Schema. The
values come from the agent's draft (so from chat and uploaded documents) or
straight from a blueprint PATCH, and nothing upstream limits their characters,
so a crafted description could run as code here.

Two rules, applied to the copy handed to the scaffolder:

* names that become identifiers must be identifiers; anything else is refused,
  because renaming one would break every reference to it;
* every other string loses the characters that can end a literal or a line
  (``"`` becomes ``”``, ``\\`` becomes ``/``, control characters become spaces).
  These are descriptions and labels, so the wording survives.
"""

from __future__ import annotations

import copy
import keyword
import re
from typing import Any

# The eval framework name lands inside a generated f-string, so it stays a plain name.
_PLAIN_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
_USE_CASE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")


class UnsafeBlueprintError(ValueError):
    """The blueprint has a name the scaffolder would paste into code as-is."""


def _is_identifier(value: Any) -> bool:
    return isinstance(value, str) and value.isidentifier() and not keyword.iskeyword(value)


def _field_names(fields: Any) -> list[Any]:
    """Field names whether ``fields`` is flat or a list of report sections."""
    if not isinstance(fields, list):
        return []
    return [f.get("id") or f.get("title", "") if isinstance(f, dict) else f for f in fields]


def _spec_problems(spec: Any, where: str) -> list[str]:
    if not isinstance(spec, dict):
        return []
    problems: list[str] = []
    name = spec.get("schema_name")
    if name not in (None, "") and not _is_identifier(name):
        problems.append(f"{where}.schema_name {name!r}")
    # Only ``fields`` become class attributes; the per-field maps are looked up
    # by those names, so a key that matches no field never reaches the source.
    for field in dict.fromkeys(_field_names(spec.get("fields"))):
        if not _is_identifier(field):
            problems.append(f"{where} field {field!r}")
    nested = spec.get("nested")
    if isinstance(nested, dict):
        for container, child in nested.items():
            if not _is_identifier(container):
                problems.append(f"{where}.nested {container!r}")
            problems += _spec_problems(child, f"{where}.nested.{container}")
    return problems


def problems(v1: dict[str, Any]) -> list[str]:
    """Names in the V1 blueprint that would reach generated code unchecked."""
    found = _spec_problems(v1.get("target_output_spec"), "target_output_spec")

    use_case_id = (v1.get("use_case") or {}).get("id")
    if isinstance(use_case_id, str) and not _USE_CASE_ID.match(use_case_id):
        found.append(f"use_case.id {use_case_id!r}")

    for art in v1.get("artifacts") or {}:
        if not _is_identifier(art):
            found.append(f"artifact {art!r}")
    for step in (v1.get("workflow") or {}).get("steps") or []:
        if not isinstance(step, dict):
            continue
        if not _is_identifier(step.get("id")):
            found.append(f"step id {step.get('id')!r}")
        for key in ("inputs", "outputs"):
            for art in step.get(key) or []:
                if not _is_identifier(art):
                    found.append(f"step {step.get('id')!r} {key[:-1]} {art!r}")

    evaluation = v1.get("evaluation")
    framework = evaluation.get("eval_framework") if isinstance(evaluation, dict) else None
    if framework not in (None, "") and not (
        isinstance(framework, str) and _PLAIN_NAME.match(framework)
    ):
        found.append(f"evaluation.eval_framework {framework!r}")
    return found


def _neutralise(value: Any) -> Any:
    if isinstance(value, str):
        return _CONTROL.sub(" ", value).replace('"', "”").replace("\\", "/")
    if isinstance(value, dict):
        return {k: _neutralise(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_neutralise(v) for v in value]
    return value


def safe_for_scaffolding(v1: dict[str, Any]) -> dict[str, Any]:
    """A copy of ``v1`` the scaffolder can paste into code without it running.

    Raises ``UnsafeBlueprintError`` naming every identifier that is not one.
    Keys are left alone: the ones that reach code are checked above, and the
    rest are the blueprint's own structure.
    """
    found = problems(v1)
    if found:
        raise UnsafeBlueprintError(
            "these names must be plain identifiers (letters, digits and _, not starting "
            "with a digit) before a PoC can be generated: " + "; ".join(found)
        )
    return _neutralise(copy.deepcopy(v1))
