"""PoC package generation for wizard_api sessions (#93).

Wraps the V1 scaffolder (``solution_wizard.scaffolder.scaffold_poc``) so the UI
can turn an approved blueprint into the runnable ``poc/`` package that #151's
listing and zip endpoints already serve. Deterministic: no API calls, no LLM.
"""

from __future__ import annotations

import ast
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
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


def _agent_v1_draft(output_dir: str | None) -> dict[str, Any] | None:
    """The agent's own V1 blueprint (``<output_dir>/use_case.blueprint.json``),
    when it is present and valid.

    The agent writes this complete V1 blueprint at spec generation. It carries
    ``selected_modules`` and the real ``input_types``, so scaffolding from it
    wires the case's own pattern (``audio_to_structured`` /
    ``document_to_structured`` / ``rag``). ``v2_to_v1_dict`` is minimal — it
    leaves ``selected_modules`` empty, drops the module into
    ``selected_building_blocks`` and hard-codes ``input_types`` to ``["text"]``
    — so ``_determine_pattern`` never matches and the scaffolder falls back to
    ``_generic`` (``template_wired: False``, a TODO stub for ``run_poc.py``).
    See #167. Returns None when there is no readable, valid draft, so the caller
    falls back to the conversion.
    """
    if not output_dir:
        return None
    try:
        with open(Path(output_dir) / "use_case.blueprint.json", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    try:
        Blueprint.model_validate(data)
    except Exception:  # noqa: BLE001 - not a valid V1 blueprint; convert instead
        return None
    return data


def build_v1_blueprint(
    v2_blueprint: dict[str, Any],
    *,
    session_id: str,
    output_dir: str | None = None,
    target_output_spec: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The V1 blueprint the scaffolder expects.

    Prefers the agent's own draft (``use_case.blueprint.json``) when it is
    present and valid: it carries the selected module and real input types, so
    the scaffolder wires the case's own pattern. Only when there is no valid
    draft does it fall back to ``v2_to_v1_dict``, whose minimal output always
    scaffolds ``_generic`` (#167).

    ``v2_to_v1_dict`` fills ``target_output_spec`` with a placeholder
    (``schema_name: "Output"``, one ``result`` field) because a V2 blueprint
    does not carry the output fields — those are agreed separately at the
    Specification step and live on the session. The session override below
    keeps the agreed schema whichever source produced the blueprint; without it
    a converted blueprint would ship a one-field dummy schema.
    """
    v1 = _agent_v1_draft(output_dir)
    if v1 is None:
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

    try:
        v1 = build_v1_blueprint(
            v2_blueprint,
            session_id=session_id,
            output_dir=output_dir,
            target_output_spec=target_output_spec,
        )
    except Exception as exc:  # noqa: BLE001 - the adapter's own errors, named for the user
        raise PocGenerationError(
            f"blueprint could not be adapted for the scaffolder: {exc}"
        ) from exc
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


#: What a package must have before it is offered as a download. The customer's
#: test report found the download button live as soon as *any* file existed, so
#: a package with no README, no requirements.txt and an unwired entrypoint could
#: be taken away and did nothing when run.
README_NAME = "README.md"
REQUIREMENTS_NAME = "requirements.txt"


def package_problems(poc_dir: str) -> list[str]:
    """What is missing or broken before this package can be handed to a user.

    Empty means ready. Nothing in the package is executed here: the entrypoint
    is parsed, not imported, because it is agent-written code and the api holds
    the model credentials. The checks cover what a first run would trip over at
    once: a missing file, an entrypoint that does not parse or wires no gaik
    component (a call that exists only in a comment does not count), an import
    that cannot be resolved, and a schema file gaik cannot load.
    """
    problems: list[str] = []

    entrypoint = os.path.join(poc_dir, _PACKAGE_ENTRYPOINT)
    if not os.path.isfile(entrypoint):
        problems.append(f"{_PACKAGE_ENTRYPOINT} is missing")
    else:
        with open(entrypoint, encoding="utf-8", errors="replace") as fh:
            source = fh.read()
        problems.extend(_entrypoint_problems(source, poc_dir))

    requirements = os.path.join(poc_dir, REQUIREMENTS_NAME)
    if not os.path.isfile(requirements):
        problems.append(f"{REQUIREMENTS_NAME} is missing")
    else:
        with open(requirements, encoding="utf-8", errors="replace") as fh:
            if "gaik" not in fh.read():
                problems.append(f"{REQUIREMENTS_NAME} does not require gaik")

    if not os.path.isfile(os.path.join(poc_dir, README_NAME)):
        problems.append(f"{README_NAME} is missing")

    problems.extend(_schema_problems(poc_dir))
    return problems


def _imports(tree: ast.AST) -> list[tuple[str, int]]:
    """Every (module, line) the entrypoint imports, leaving out imports guarded by
    a ``try`` that catches ImportError: those are optional by the author's intent."""
    found: list[tuple[str, int]] = []

    def guarded(node: ast.Try) -> bool:
        for handler in node.handlers:
            names = ast.dump(handler.type) if handler.type is not None else "bare"
            if any(n in names for n in ("ImportError", "ModuleNotFoundError", "Exception", "bare")):
                return True
        return False

    def visit(node: ast.AST) -> None:
        if isinstance(node, ast.Try) and guarded(node):
            for child in node.handlers + node.orelse + node.finalbody:
                visit(child)
            return
        if isinstance(node, ast.Import):
            found.extend((alias.name, node.lineno) for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            found.append((node.module, node.lineno))
        for child in ast.iter_child_nodes(node):
            visit(child)

    visit(tree)
    return found


_TODO_MARKER = re.compile(r"\b(TODO|FIXME)\b")


def _todo_markers(source: str) -> list[int]:
    """Line numbers of the TODO/FIXME markers in ``source`` (comments and strings)."""
    return [n for n, line in enumerate(source.splitlines(), start=1) if _TODO_MARKER.search(line)]


def _entrypoint_problems(source: str, poc_dir: str) -> list[str]:
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return [f"{_PACKAGE_ENTRYPOINT} does not parse (line {exc.lineno}: {exc.msg})"]

    imports = _imports(tree)
    # The scaffolder's _generic fallback is a TODO stub, and a skeleton whose
    # component calls are comments names gaik in those comments. Only an import
    # statement counts as wiring a component.
    if not any(module.split(".")[0] == "gaik" for module, _ in imports):
        return [f"{_PACKAGE_ENTRYPOINT} does not wire any gaik component"]

    # The agent writes the entrypoint in steps and leaves TODO markers where it
    # has not been yet. A package that already imports gaik was offered as
    # ready while nine such markers were still in it (#252): the markers say
    # the author is not done, so the package is not.
    markers = _todo_markers(source)
    if markers:
        first = markers[0]
        return [
            f"{_PACKAGE_ENTRYPOINT} still has {len(markers)} TODO marker(s), "
            f"first at line {first}: the package is not finished"
        ]

    # Without gaik in this environment we cannot tell what the runner has.
    if importlib.util.find_spec("gaik") is None:
        return []
    problems: list[str] = []
    seen: set[str] = set()
    for module, line in imports:
        top = module.split(".")[0]
        if top in seen or top in sys.stdlib_module_names or _is_local_module(poc_dir, top):
            continue
        seen.add(top)
        if not _resolvable(module):
            problems.append(
                f"{_PACKAGE_ENTRYPOINT} line {line} imports {module}, "
                "which the sandbox image does not have"
            )
    return problems


#: Package folders that hold inputs and results, never the package's own code.
_NOT_CODE_DIRS = {"sample_input", "output", "__pycache__", ".venv", "venv"}


def _is_local_module(poc_dir: str, name: str) -> bool:
    """A module the package ships itself: at its root, or one folder down.

    One folder down covers the wizard's own layout: ``schemas/output_schema.py``
    is imported after ``sys.path.insert(0, .../schemas)``, and a package that did
    so was refused as importing a module the sandbox lacks (UC03, 6 Oct 2026).
    """

    def _here(folder: str) -> bool:
        return os.path.isfile(os.path.join(folder, name + ".py")) or os.path.isdir(
            os.path.join(folder, name)
        )

    if _here(poc_dir):
        return True
    try:
        entries = os.scandir(poc_dir)
    except OSError:
        return False
    with entries:
        return any(
            entry.is_dir() and entry.name not in _NOT_CODE_DIRS and _here(entry.path)
            for entry in entries
        )


def _resolvable(module: str) -> bool:
    """The api image installs the same gaik extras as the runner (a test keeps the
    two lists equal), so a module the api cannot find is one the runner lacks."""
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError, AttributeError):
        return False


REQUIREMENTS_JSON = os.path.join("schemas", "output_schema_requirements.json")


def _null_non_string_defaults(node: Any) -> None:
    if isinstance(node, dict):
        if (
            "field_name" in node
            and node.get("default") is not None
            and not isinstance(node["default"], str)
        ):
            node["default"] = None
        for value in node.values():
            _null_non_string_defaults(value)
    elif isinstance(node, list):
        for value in node:
            _null_non_string_defaults(value)


def _schema_problems(poc_dir: str) -> list[str]:
    path = os.path.join(poc_dir, REQUIREMENTS_JSON)
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as exc:
        return [f"{REQUIREMENTS_JSON} is not valid JSON ({exc})"]
    try:
        from gaik.software_components.extractor import ExtractionRequirements
    except ImportError:
        return []
    # run_poc.py resets a non-string field default to null before loading, so a
    # default of that kind is not a reason to hold the package back.
    _null_non_string_defaults(data)
    # Composite files (parent_with_nested_list) have another body; only the
    # plain extraction layout is checked here.
    if isinstance(data, dict) and data.get("requirements_type", "extraction") != "extraction":
        return []
    body = data.get("requirements") if isinstance(data, dict) else None
    try:
        if not isinstance(body, dict):
            return [f'{REQUIREMENTS_JSON} has no "requirements" section']
        ExtractionRequirements(**body)
    except Exception as exc:  # pydantic.ValidationError, whatever the version
        first = str(exc).strip().splitlines()
        detail = " ".join(first[1:3]).strip() or (first[0] if first else "invalid")
        return [f"{REQUIREMENTS_JSON} cannot be loaded by gaik ({detail[:160]})"]
    return []


#: The files whose content decides whether a preflight is still current. The
#: agent rewrites ``run_poc.py`` after a package first reads as ready, so a check
#: is tied to what it looked at, not to the package merely existing.
_VERSION_FILES = (
    "run_poc.py",
    "config.yaml",
    "provider_config.py",
    "requirements.txt",
    os.path.join("schemas", "output_schema.py"),
    os.path.join("schemas", "output_schema_requirements.json"),
)


def package_version(poc_dir: str) -> str:
    """A short digest of the files a preflight reads; changes when any of them does."""
    digest = hashlib.sha256()
    for name in _VERSION_FILES:
        path = os.path.join(poc_dir, name)
        digest.update(name.encode())
        if os.path.isfile(path):
            with open(path, "rb") as fh:
                digest.update(fh.read())
    return digest.hexdigest()[:16]


def package_is_ready(poc_dir: str) -> bool:
    return not package_problems(poc_dir)


# ---------------------------------------------------------------------------
# Sample input for a sandbox run (#95)
# ---------------------------------------------------------------------------

#: Where an uploaded input lands. It is inside the package on purpose: the zip
#: endpoint already serves the whole poc/ folder and the Job's init container
#: unpacks it, so an upload reaches the run with no change to the manifest. It
#: also survives regeneration — `_PRESERVED_DIRS` keeps it.
SAMPLE_INPUT_DIR = "sample_input"

#: One file, not a corpus. The run has ten minutes and a 1 GiB scratch volume.
MAX_INPUT_BYTES = 50 * 1024 * 1024


class InputRejectedError(ValueError):
    """The upload is not something we will write into a package."""


def safe_input_name(filename: str) -> str:
    """The name we will store, or refuse.

    Uploads go into ``sample_input/`` and nowhere else. The package root holds
    ``run_poc.py`` — the file the sandbox Job executes — so a name that can
    climb out of the input directory is the difference between handing the run
    some data and handing it a different program.
    """
    raw = (filename or "").strip()
    if not raw:
        raise InputRejectedError("the file has no name")

    # A browser legitimately sends a path when the user picks a file from a
    # folder, so a directory prefix is stripped rather than refused. A ".."
    # segment is not that — it is an attempt to leave the input directory, and
    # quietly turning it into a plain name would hide what was asked for.
    parts = raw.replace("\\", "/").split("/")
    if any(part == ".." for part in parts):
        raise InputRejectedError(f"'{filename}' tries to leave the input directory")
    if raw.startswith("/") or raw.startswith("\\") or (len(raw) > 1 and raw[1] == ":"):
        raise InputRejectedError(f"'{filename}' is an absolute path")

    name = parts[-1]
    if name in {"", ".", ".."} or name.startswith("."):
        raise InputRejectedError(f"'{filename}' is not a usable file name")
    if os.sep in name or (os.altsep and os.altsep in name):
        raise InputRejectedError(f"'{filename}' is not a usable file name")
    if len(name) > 200:
        raise InputRejectedError("the file name is too long")
    return name


def sample_input_dir(poc_dir: str) -> str:
    return os.path.join(poc_dir, SAMPLE_INPUT_DIR)


def save_sample_input(poc_dir: str, filename: str, data: bytes) -> str:
    """Write one input file into the package, and return its stored name."""
    if len(data) > MAX_INPUT_BYTES:
        raise InputRejectedError(f"the file is larger than {MAX_INPUT_BYTES // (1024 * 1024)} MB")
    if not data:
        raise InputRejectedError("the file is empty")

    name = safe_input_name(filename)
    target_dir = sample_input_dir(poc_dir)
    os.makedirs(target_dir, exist_ok=True)

    target = os.path.realpath(os.path.join(target_dir, name))
    root = os.path.realpath(target_dir)
    # Belt and braces: even with the name checked, the resolved path must still
    # be inside the input directory — a symlinked sample_input would otherwise
    # let a write land elsewhere.
    if target != root and not target.startswith(root + os.sep):
        raise InputRejectedError(f"'{filename}' resolves outside the input directory")

    with open(target, "wb") as fh:
        fh.write(data)
    return name


def list_sample_inputs(poc_dir: str) -> list[dict[str, object]]:
    target_dir = sample_input_dir(poc_dir)
    if not os.path.isdir(target_dir):
        return []
    entries = []
    for name in sorted(os.listdir(target_dir)):
        path = os.path.join(target_dir, name)
        if os.path.isfile(path):
            entries.append({"name": name, "bytes": os.path.getsize(path)})
    return entries


def delete_sample_input(poc_dir: str, filename: str) -> bool:
    name = safe_input_name(filename)
    path = os.path.join(sample_input_dir(poc_dir), name)
    if not os.path.isfile(path):
        return False
    os.remove(path)
    return True


# ---------------------------------------------------------------------------
# The deployable package (#143)
# ---------------------------------------------------------------------------

#: What belongs to developing the PoC but not to handing it over. The sample
#: input is the developer's test document, `output/` is the previous run's
#: result, and __pycache__ was found in a package during review — none of it is
#: part of what someone else installs.
_NOT_DEPLOYABLE_DIRS = (SAMPLE_INPUT_DIR, "output")
_NOT_DEPLOYABLE_NAMES = (MANIFEST_NAME, ".env")
_NOT_DEPLOYABLE_SUFFIXES = (".pyc", ".pyo")


def is_deployable_path(relative_path: str) -> bool:
    """Whether one file inside poc/ belongs in the deployable package."""
    parts = relative_path.replace("\\", "/").split("/")
    if any(part == "__pycache__" for part in parts):
        return False
    if parts[0] in _NOT_DEPLOYABLE_DIRS:
        return False
    name = parts[-1]
    if name in _NOT_DEPLOYABLE_NAMES:
        return False
    return not name.endswith(_NOT_DEPLOYABLE_SUFFIXES)


def deployable_files(poc_dir: str) -> list[str]:
    """The package as someone else receives it, relative to poc/."""
    found = []
    for root, _, names in os.walk(poc_dir):
        for name in names:
            rel = os.path.relpath(os.path.join(root, name), poc_dir)
            if is_deployable_path(rel):
                found.append(rel)
    return sorted(found)
