"""PoC package generation for wizard_api sessions (#93).

Wraps the V1 scaffolder (``solution_wizard.scaffolder.scaffold_poc``) so the UI
can turn an approved blueprint into the runnable ``poc/`` package that #151's
listing and zip endpoints already serve. Deterministic: no API calls, no LLM.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path
from typing import Any

try:
    from solution_wizard.blueprint import Blueprint
    from solution_wizard.scaffolder import scaffold_poc
    from solution_wizard.v2_adapter import v2_to_v1_dict

    _SOLUTION_WIZARD_AVAILABLE = True
except ImportError:  # pragma: no cover - optional in minimal installs
    _SOLUTION_WIZARD_AVAILABLE = False


class PocGenerationError(RuntimeError):
    pass


#: Records what *we* scaffolded, so a later run can tell its own output apart
#: from files the agent wrote during the conversation. See ``_clear_previous``.
#: It lives beside ``poc/`` rather than inside it, so the package the user
#: downloads is exactly what the scaffolder produced — no wizard bookkeeping.
MANIFEST_NAME = ".wizard-scaffold.json"

#: Subtrees a regeneration must never touch: the user's sample inputs, the
#: results of an earlier run, and hand-curated eval ground truth.
_PRESERVED_DIRS = ("sample_input", "output", os.path.join("evals", "ground_truth"))

#: What makes ``poc/`` a package. The agent writes ``schemas/`` and ``prompts/``
#: already at the schema-design step, long before any package exists, so those
#: alone are work in progress for the scaffolder to build on — not a finished
#: PoC to keep.
_PACKAGE_ENTRYPOINT = "run_poc.py"


def solution_wizard_available() -> bool:
    return _SOLUTION_WIZARD_AVAILABLE


def _blueprint_fingerprint(v1: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(v1, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def build_v1_blueprint(
    v2_blueprint: dict[str, Any],
    *,
    session_id: str,
    target_output_spec: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The V1 blueprint the scaffolder expects.

    ``v2_to_v1_dict`` fills ``target_output_spec`` with a placeholder
    (``schema_name: "Output"``, one ``result`` field) because a V2 blueprint
    does not carry the output fields — those are agreed separately at the
    Specification step and live on the session. Without this override every PoC
    would ship a one-field dummy schema instead of the agreed output.
    """
    v1 = v2_to_v1_dict(v2_blueprint, session_id=session_id)
    if target_output_spec and target_output_spec.get("fields"):
        v1["target_output_spec"] = target_output_spec
    return v1


def _is_preserved(relative_path: str) -> bool:
    return any(
        relative_path == keep or relative_path.startswith(keep + os.sep) for keep in _PRESERVED_DIRS
    )


def _read_manifest(root: Path) -> dict[str, Any] | None:
    try:
        with open(root / MANIFEST_NAME, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _clear_previous(poc_dir: Path, manifest: dict[str, Any]) -> None:
    """Delete the files our own previous run wrote.

    The scaffolder deliberately leaves an existing ``schemas/output_schema.py``
    alone, so that a schema the user reviewed during the conversation is not
    overwritten. That guard would also freeze *our* schema, making a
    regeneration after a blueprint change a silent no-op. Clearing only what
    this manifest claims keeps both properties: the agent's files survive, ours
    are refreshed.
    """
    for relative in manifest.get("files", []):
        if _is_preserved(relative):
            continue
        target = poc_dir / relative
        try:
            if target.is_file():
                target.unlink()
        except OSError:  # pragma: no cover - best effort, scaffolder rewrites anyway
            pass


def _file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _agent_edited(poc_dir: Path, manifest: dict[str, Any]) -> bool:
    """Whether the agent rewrote any file our last run wrote.

    The agent finishes a composed pipeline by wiring the ``run_poc.py`` we
    scaffolded (there is no template for it). A regeneration that cleared "our"
    files would silently put the TODO stub back over that work. Manifests
    written before hashes were recorded cannot tell, and count as unedited.
    """
    for relative, digest in (manifest.get("hashes") or {}).items():
        target = poc_dir / relative
        try:
            if target.is_file() and _file_hash(target) != digest:
                return True
        except OSError:  # pragma: no cover - unreadable counts as not ours to judge
            continue
    return False


def _agent_package(poc_dir: Path) -> dict[str, Any]:
    return {
        "generated": True,
        "source": "agent",
        "scaffolded": False,
        "pattern": "",
        "template_wired": True,
        "files": _relative_files(poc_dir),
        "regenerated": False,
        "blueprint_changed": False,
    }


def _relative_files(poc_dir: Path) -> list[str]:
    return sorted(
        str(path.relative_to(poc_dir))
        for path in poc_dir.rglob("*")
        if path.is_file() and "__pycache__" not in path.relative_to(poc_dir).parts
    )


def generate_poc(
    v2_blueprint: dict[str, Any],
    *,
    session_id: str,
    output_dir: str,
    target_output_spec: dict[str, Any] | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Scaffold ``<output_dir>/poc`` from the session's active blueprint.

    Returns the pattern the scaffolder picked, the files now in the package,
    and whether this replaced an earlier scaffold of ours.

    A package the *agent* produced during the conversation is left alone unless
    ``force`` says otherwise: the agent wires the real GAIK component for the
    case's own pattern and can add synthetic test data and an eval rubric,
    which this deterministic scaffolder cannot reproduce. Overwriting it would
    trade a working, case-specific PoC for a generic template.
    """
    if not _SOLUTION_WIZARD_AVAILABLE:
        raise PocGenerationError("solution_wizard package is not installed")
    if not output_dir:
        raise PocGenerationError("session has no output_dir")

    root = Path(output_dir)
    poc_dir = root / "poc"
    previous = _read_manifest(root)

    if not force:
        if previous is None and (poc_dir / _PACKAGE_ENTRYPOINT).is_file():
            # No manifest and an entrypoint of its own: the agent built the package.
            return _agent_package(poc_dir)
        if previous is not None and _agent_edited(poc_dir, previous):
            # We scaffolded it, then the agent wired it: the package is now theirs.
            return _agent_package(poc_dir)

    v1 = build_v1_blueprint(
        v2_blueprint, session_id=session_id, target_output_spec=target_output_spec
    )
    try:
        blueprint = Blueprint.model_validate(v1)
    except Exception as exc:  # pydantic ValidationError and friends
        raise PocGenerationError(f"blueprint is not scaffoldable: {exc}") from exc

    # Files already here that our last run did not write are the agent's — the
    # schema and extraction prompt approved in the conversation. The scaffolder
    # builds on them, and leaving them out of the manifest keeps a later
    # regeneration from deleting them.
    ours_before = set(previous.get("files", [])) if previous else set()
    agent_files = set(_relative_files(poc_dir)) - ours_before if poc_dir.is_dir() else set()

    if previous:
        _clear_previous(poc_dir, previous)

    try:
        result = scaffold_poc(blueprint, root)
    except Exception as exc:
        raise PocGenerationError(f"scaffolding failed: {exc}") from exc

    files = _relative_files(poc_dir)
    fingerprint = _blueprint_fingerprint(v1)
    try:
        with open(root / MANIFEST_NAME, "w", encoding="utf-8") as fh:
            ours = [f for f in files if f not in agent_files]
            json.dump(
                {
                    "blueprint": fingerprint,
                    "files": ours,
                    "hashes": {f: _file_hash(poc_dir / f) for f in ours},
                },
                fh,
                indent=2,
            )
    except OSError as exc:  # pragma: no cover - the package itself is fine
        raise PocGenerationError(f"could not record the scaffold manifest: {exc}") from exc

    return {
        "generated": True,
        "source": "scaffolder",
        "scaffolded": True,
        "pattern": result.get("pattern", ""),
        "template_wired": bool(result.get("template_wired")),
        "files": files,
        "regenerated": previous is not None,
        "blueprint_changed": previous is None or previous.get("blueprint") != fingerprint,
    }


def discard_poc(output_dir: str) -> None:
    """Remove a generated package. Only used by tests and by callers that need
    a clean slate — never wired to a route, because losing a PoC should not be
    one request away."""
    if not output_dir:
        return
    shutil.rmtree(Path(output_dir) / "poc", ignore_errors=True)
