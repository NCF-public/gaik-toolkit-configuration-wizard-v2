"""Cases: the generated solution used as a working process, not only a package.

A case is one pass through the use case's BPMN: someone gives the input (a voice
report, documents), the PoC runs in the sandbox on that input, and a reviewer
approves, returns or rejects what it produced. The UI builds its roles and
screens from the BPMN and its review form from ``target_output_spec``; this
module keeps each case's state and inputs and reads the run's result back.

Cases live on disk beside the session's package (``<output_dir>/cases/<id>/``),
like the package and its sample input do: ``case.json`` for the state and
``inputs/`` for the files. A sandbox run of a case gets the package with that
case's inputs in place of ``sample_input/`` (see the ``case`` parameter of the
package download), so two cases never share or overwrite each other's input.
"""

from __future__ import annotations

import json
import os
import re
import uuid
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from wizard_api.services import poc_service

CASES_DIR = "cases"
CASE_FILE = "case.json"
INPUTS_DIR = "inputs"

#: draft → running → review → approved | rejected, with review → returned →
#: running for a correction, and running → failed when the run did not finish.
#: A process with no reviewer goes running → completed.
STATUSES = (
    "draft",
    "running",
    "review",
    "returned",
    "approved",
    "rejected",
    "failed",
    "completed",
)
EDITABLE = ("draft", "returned", "failed")

OUTPUT_BEGIN = "=== POC OUTPUT BEGIN ==="
OUTPUT_END = "=== POC OUTPUT END ==="


class CaseNotFoundError(LookupError):
    pass


class CaseStateError(ValueError):
    """The action does not fit the case's current status."""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _cases_root(output_dir: str) -> Path:
    return Path(output_dir) / CASES_DIR


def _case_dir(output_dir: str, case_id: str) -> Path:
    try:
        uuid.UUID(case_id)
    except ValueError as exc:
        raise CaseNotFoundError(case_id) from exc
    return _cases_root(output_dir) / case_id


def _write(output_dir: str, case: dict[str, Any]) -> dict[str, Any]:
    path = _case_dir(output_dir, case["id"]) / CASE_FILE
    tmp = path.with_suffix(".tmp")
    # The input listing is read from disk each time, so it is not stored.
    stored = {k: v for k, v in case.items() if k != "inputs"}
    tmp.write_text(json.dumps(stored, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    return case


def _event(case: dict[str, Any], role: str, action: str, detail: str = "") -> None:
    case["events"].append({"at": _now(), "role": role, "action": action, "detail": detail})


def create_case(output_dir: str, *, created_by: str) -> dict[str, Any]:
    case_id = str(uuid.uuid4())
    (_case_dir(output_dir, case_id) / INPUTS_DIR).mkdir(parents=True)
    case = {
        "id": case_id,
        "created_at": _now(),
        "created_by": created_by,
        "status": "draft",
        "round": 1,
        "note": "",
        "comment": "",
        "run_id": None,
        "run_message": None,
        "result": None,
        "record": None,
        "events": [],
        # Several people may give parts of the input, each in their own user
        # task: which tasks are done, which task each file came from, what
        # each one wrote, and where a returned case goes back to.
        "steps_done": [],
        "input_tasks": {},
        "notes": {},
        "return_to": None,
    }
    return _write(output_dir, case)


def get_case(output_dir: str, case_id: str) -> dict[str, Any]:
    path = _case_dir(output_dir, case_id) / CASE_FILE
    try:
        case = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CaseNotFoundError(case_id) from exc
    for key, default in (
        ("steps_done", []),
        ("input_tasks", {}),
        ("notes", {}),
        ("return_to", None),
    ):
        case.setdefault(key, default)
    case["inputs"] = [
        {**f, "task": case["input_tasks"].get(f["name"])} for f in list_inputs(output_dir, case_id)
    ]
    return case


def list_cases(output_dir: str) -> list[dict[str, Any]]:
    root = _cases_root(output_dir)
    if not root.is_dir():
        return []
    cases = []
    for entry in root.iterdir():
        try:
            case = get_case(output_dir, entry.name)
        except CaseNotFoundError:
            continue
        cases.append({k: case[k] for k in ("id", "created_at", "status", "round")})
    return sorted(cases, key=lambda c: c["created_at"], reverse=True)


# -- inputs ---------------------------------------------------------------------


def inputs_dir(output_dir: str, case_id: str) -> Path:
    return _case_dir(output_dir, case_id) / INPUTS_DIR


def list_inputs(output_dir: str, case_id: str) -> list[dict[str, Any]]:
    folder = inputs_dir(output_dir, case_id)
    if not folder.is_dir():
        return []
    return [
        {"name": p.name, "bytes": p.stat().st_size} for p in sorted(folder.iterdir()) if p.is_file()
    ]


def _require_editable(case: dict[str, Any]) -> None:
    if case["status"] not in EDITABLE:
        raise CaseStateError(f"the case is {case['status']}; its input can no longer change")


def save_input(
    output_dir: str, case_id: str, filename: str, data: bytes, *, task: str | None = None
) -> str:
    """Store one input file of a case. Same rules as the package's sample input.

    ``task`` is the user task (BPMN id) whose person gave the file.
    """
    case = get_case(output_dir, case_id)
    _require_editable(case)
    name = _save_into(inputs_dir(output_dir, case_id), filename, data)
    if task:
        case["input_tasks"][name] = task[:200]
        _write(output_dir, case)
    return name


def _save_into(folder: Path, filename: str, data: bytes) -> str:
    if len(data) > poc_service.MAX_INPUT_BYTES:
        raise poc_service.InputRejectedError(
            f"the file is larger than {poc_service.MAX_INPUT_BYTES // (1024 * 1024)} MB"
        )
    if not data:
        raise poc_service.InputRejectedError("the file is empty")
    name = poc_service.safe_input_name(filename)
    folder.mkdir(parents=True, exist_ok=True)
    target = (folder / name).resolve()
    if target.parent != folder.resolve():
        raise poc_service.InputRejectedError(f"'{filename}' resolves outside the input directory")
    target.write_bytes(data)
    return name


def input_path(output_dir: str, case_id: str, filename: str) -> Path | None:
    name = poc_service.safe_input_name(filename)
    path = inputs_dir(output_dir, case_id) / name
    return path if path.is_file() else None


def delete_input(output_dir: str, case_id: str, filename: str) -> bool:
    _require_editable(get_case(output_dir, case_id))
    path = input_path(output_dir, case_id, filename)
    if path is None:
        return False
    path.unlink()
    case = get_case(output_dir, case_id)
    if case["input_tasks"].pop(path.name, None) is not None:
        _write(output_dir, case)
    return True


# -- the workflow ----------------------------------------------------------------


def complete_step(
    output_dir: str, case_id: str, *, task: str, role: str, note: str
) -> dict[str, Any]:
    """One person's part of the input is done; the case waits for the next one."""
    case = get_case(output_dir, case_id)
    _require_editable(case)
    task = task.strip()[:200]
    if not task:
        raise CaseStateError("name the task that is done")
    if not any(f.get("task") == task for f in case["inputs"]):
        raise CaseStateError("add this step's input before marking it done")
    if task not in case["steps_done"]:
        case["steps_done"].append(task)
    case["notes"][task] = note.strip()
    _event(case, role, "step", note.strip())
    return _write(output_dir, case)


def mark_submitted(
    output_dir: str,
    case_id: str,
    *,
    run_id: str,
    role: str,
    note: str,
    task: str | None = None,
) -> dict[str, Any]:
    case = get_case(output_dir, case_id)
    _require_editable(case)
    if not case["inputs"]:
        raise CaseStateError("add the input before submitting the case")
    case.update(status="running", run_id=run_id, run_message=None, note=note.strip())
    if task:
        if task not in case["steps_done"]:
            case["steps_done"].append(task)
        case["notes"][task] = note.strip()
    _event(case, role, "submit", case["note"])
    return _write(output_dir, case)


def require_submittable(output_dir: str, case_id: str) -> dict[str, Any]:
    case = get_case(output_dir, case_id)
    _require_editable(case)
    if not case["inputs"]:
        raise CaseStateError("add the input before submitting the case")
    return case


def finish_run(
    output_dir: str,
    case_id: str,
    *,
    phase: str,
    log: str | None,
    message: str | None,
    spec: dict[str, Any] | None,
    review_needed: bool = True,
) -> dict[str, Any]:
    """Settle a running case from its run: the result for review, or why it failed.

    When the process has no review task (the person who asked reads the answer
    themselves), a result completes the case.
    """
    case = get_case(output_dir, case_id)
    if case["status"] != "running":
        return case
    result = (
        parse_run_output(log or "", spec, run_id=case.get("run_id"))
        if phase == "succeeded"
        else None
    )
    if result and result.get("record") is not None:
        case.update(
            status="review" if review_needed else "completed",
            result=result,
            record=result["record"],
            run_message=None,
        )
        _event(case, "ai", "result")
    else:
        reason = message or (
            "the run finished but wrote no result matching the output fields"
            if phase == "succeeded"
            else f"the run ended: {phase}"
        )
        case.update(status="failed", run_message=reason)
        _event(case, "ai", "failed", reason)
    return _write(output_dir, case)


def review(
    output_dir: str,
    case_id: str,
    *,
    action: str,
    role: str,
    record: dict[str, Any] | list[dict[str, Any]] | None,
    comment: str,
    spec: dict[str, Any] | None,
    return_to: str | None = None,
) -> dict[str, Any]:
    case = get_case(output_dir, case_id)
    if case["status"] != "review":
        raise CaseStateError(f"the case is {case['status']}, not waiting for review")
    comment = comment.strip()
    if action == "approve":
        record = record if record is not None else case["record"]
        problems = record_problems(record, spec)
        if problems:
            raise CaseStateError("; ".join(problems))
        record = _mark_approved(record, spec)
        case.update(status="approved", record=record)
        _event(case, role, "approve", _changes(case["result"]["record"], record))
    elif action == "return":
        if not comment:
            raise CaseStateError("say what needs correcting")
        # Back to the step named, or to the first; the steps after it are redone.
        done = case["steps_done"]
        keep = done[: done.index(return_to)] if return_to in done else []
        case.update(
            status="returned",
            comment=comment,
            round=case["round"] + 1,
            return_to=return_to,
            steps_done=keep,
        )
        _event(case, role, "return", comment)
    elif action == "reject":
        if not comment:
            raise CaseStateError("say why the case is rejected")
        case.update(status="rejected", comment=comment)
        _event(case, role, "reject", comment)
    else:
        raise CaseStateError(f"unknown action {action!r}")
    return _write(output_dir, case)


def _mark_approved(record: Any, spec: dict[str, Any] | None) -> Any:
    """A record that carries its own review status says it was approved, when
    its spec allows that value (a meeting record's ``review_status``)."""
    allowed = ((spec or {}).get("allowed_values") or {}).get("review_status") or []
    if isinstance(record, dict) and "review_status" in record and "approved" in allowed:
        return {**record, "review_status": "approved"}
    return record


def _changes(before: Any, after: Any) -> str:
    if isinstance(before, list) and isinstance(after, list):
        return ", ".join(
            f"#{i + 1}"
            for i, (a, b) in enumerate(zip(before, after, strict=False))
            if json.dumps(a, sort_keys=True) != json.dumps(b, sort_keys=True)
        )
    if not isinstance(before, dict) or not isinstance(after, dict):
        return ""
    changed = [
        k
        for k in after
        if json.dumps(after.get(k), sort_keys=True) != json.dumps(before.get(k), sort_keys=True)
    ]
    return ", ".join(changed)


_FORMATS = {
    "DD/MM/YYYY": r"(0[1-9]|[12]\d|3[01])/(0[1-9]|1[0-2])/\d{4}",
    "YYYY-MM-DD": r"\d{4}-\d{2}-\d{2}",
    "HH:MM": r"([01]\d|2[0-3]):[0-5]\d",
}


def is_document(record: Any) -> bool:
    """A result made of sections of text (a report), rather than a flat record."""
    sections = record.get("sections") if isinstance(record, dict) else None
    return (
        isinstance(sections, list)
        and bool(sections)
        and all(isinstance(s, dict) and "text" in s for s in sections)
    )


def record_problems(record: Any, spec: dict[str, Any] | None) -> list[str]:
    """What stops a reviewed record from being approved: the same checks the form makes."""
    if isinstance(record, list):
        # One record per item (answers to several questions): each is checked.
        return [
            f"#{i + 1}: {problem}"
            for i, item in enumerate(record)
            for problem in record_problems(item, spec)
        ]
    if not isinstance(record, dict):
        return ["the record is not an object"]
    if is_document(record):
        # A generated document (report sections): reviewed as text, not as fields.
        return [
            f"section {s.get('title') or s.get('id') or i + 1} is empty"
            for i, s in enumerate(record["sections"])
            if not str(s.get("text") or "").strip()
        ]
    if not spec:
        return []
    problems = []
    for field in spec.get("fields") or []:
        if "." in field:
            continue  # a column of a table field, checked per row below
        problem = _value_problem(spec, field, record.get(field))
        if problem:
            problems.append(f"{field} {problem}")
    for field in spec.get("fields") or []:
        if "." not in field:
            continue
        table, column = field.split(".", 1)
        rows = record.get(_table_of(spec, table, record))
        for i, row in enumerate(rows if isinstance(rows, list) else []):
            if isinstance(row, dict):
                problem = _value_problem(spec, field, row.get(column))
                if problem:
                    problems.append(f"{table} {i + 1}: {column} {problem}")
    return problems


def _table_of(spec: dict[str, Any], prefix: str, record: dict[str, Any]) -> str:
    """The list field a dotted field belongs to: ``line_item.x`` → ``line_items``."""
    for name in (prefix, f"{prefix}s", f"{prefix}es"):
        if isinstance(record.get(name), list):
            return name
    return prefix


def _value_problem(spec: dict[str, Any], field: str, value: Any) -> str | None:
    # An empty list is a value given ("no citations" for a refused answer);
    # missing is null or blank text.
    empty = value is None or (isinstance(value, str) and not value.strip())
    if field in (spec.get("required_fields") or []) and empty:
        return "is required"
    if empty or not isinstance(value, str):
        return None
    allowed = (spec.get("allowed_values") or {}).get(field)
    if isinstance(allowed, list) and value not in allowed:
        return f"must be one of {', '.join(allowed)}"
    description = (spec.get("field_descriptions") or {}).get(field) or ""
    for token, pattern in _FORMATS.items():
        if token in description and not re.fullmatch(pattern, value):
            return f"must be {token}"
    return None


def normalize_spec(spec: dict[str, Any] | None) -> dict[str, Any] | None:
    """The output spec with its field list as names.

    The agent writes ``fields`` as names for a record, but as objects for a
    report (``{"id": "executive_summary", "title": …, "instructions": …}``);
    everything downstream reads names.
    """
    if not isinstance(spec, dict):
        return spec
    names = []
    for field in spec.get("fields") or []:
        name = (
            field
            if isinstance(field, str)
            else ((field.get("id") or field.get("name")) if isinstance(field, dict) else None)
        )
        if isinstance(name, str) and name:
            names.append(name)
    return {**spec, "fields": names}


# -- reading a run's result ------------------------------------------------------


def parse_run_output(
    log: str, spec: dict[str, Any] | None, run_id: str | None = None
) -> dict[str, Any]:
    """The files the run printed between the output markers, and which is which.

    The run container prints each top-level json/txt/md file of ``output/``
    between two markers (sandbox-job.yaml). The record is the JSON whose keys
    are the output fields; a JSON with ``passed`` is the grounding check; a
    ``*transcript*.txt`` is the transcript.

    Each marker line ends with the run's id (#293), and with ``run_id`` only
    those lines count: a PoC that echoes its input (a transcript, a document)
    could otherwise print a marker of its own and pass that text off as the
    result. A log from before the id was added has bare markers and is read
    as it was.
    """
    empty = {"record": None, "validation": None, "transcript": "", "document": "", "files": []}
    tag = f" {run_id}" if run_id and f"{OUTPUT_BEGIN} {run_id}" in log else ""
    begin_marker, end_marker = f"{OUTPUT_BEGIN}{tag}\n", f"{OUTPUT_END}{tag}"
    begin = log.find(begin_marker)
    if begin < 0:
        if tag or log.find(OUTPUT_BEGIN) < 0:
            return empty
        begin_marker = OUTPUT_BEGIN
        begin = log.find(begin_marker)
    end = log.find(end_marker, begin + len(begin_marker))
    block = log[begin + len(begin_marker) : end if end > begin else len(log)]
    if not block.startswith("\n"):
        block = "\n" + block
    header = rf"\n--- output/([^\n]+?) ---{re.escape(tag)} *\n"
    parts = re.split(header, block)
    # re.split gives [before, name1, body1, name2, body2, ...].
    files = {parts[i]: parts[i + 1] for i in range(1, len(parts) - 1, 2)}
    fields = set((normalize_spec(spec) or {}).get("fields") or [])
    record = validation = None
    transcript = document = ""
    for name, body in files.items():
        body = body.strip()
        if name.endswith(".json"):
            try:
                data = json.loads(body)
            except ValueError:
                continue
            first = data[0] if isinstance(data, list) and data else data
            if not isinstance(first, dict):
                continue
            if record is None and ((fields and fields & set(first)) or is_document(first)):
                # Several records (one per question) stay a list; one is the record.
                many = isinstance(data, list) and len(data) > 1
                record = data if many and all(isinstance(d, dict) for d in data) else first
            elif validation is None and "passed" in first:
                validation = first
        elif "transcript" in name and name.endswith(".txt"):
            transcript = body
        elif name.endswith(".md") and not document:
            document = body
    return {
        "record": record,
        "validation": validation,
        "transcript": transcript,
        "document": document,
        "files": sorted(files),
    }


# -- the process the UI is built from -------------------------------------------

_BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"
_KINDS = (
    "userTask",
    "manualTask",
    "serviceTask",
    "sendTask",
    "scriptTask",
    "task",
    "startEvent",
    "endEvent",
    "exclusiveGateway",
    "parallelGateway",
)


def process_from_bpmn(xml: str) -> dict[str, Any]:
    """Lanes, nodes and sequence flows of the BPMN, in the shape the case UI reads.

    A lane holding a user or manual task is a role; one holding only service
    tasks is the system. Data objects a task writes or reads are kept by name,
    so the input screen knows what to ask for.
    """
    root = ET.fromstring(xml)
    proc = root.find(f"{_BPMN}process")
    if proc is None:
        return {"lanes": [], "nodes": [], "flows": []}
    data_names = {d.get("id"): d.get("name") for d in proc.iter(f"{_BPMN}dataObjectReference")}
    nodes: dict[str, dict[str, Any]] = {}
    for kind in _KINDS:
        for el in proc.iter(f"{_BPMN}{kind}"):
            nodes[el.get("id")] = {
                "id": el.get("id"),
                "kind": kind,
                # "[A2S] Transcribe …": the component code is for the diagram reader.
                "name": re.sub(r"^\[[A-Z0-9]+\]\s*", "", el.get("name") or ""),
                "lane": None,
                "inputs": [
                    data_names.get(a.findtext(f"{_BPMN}sourceRef"))
                    for a in el.iter(f"{_BPMN}dataInputAssociation")
                ],
                "outputs": [
                    data_names.get(a.findtext(f"{_BPMN}targetRef"))
                    for a in el.iter(f"{_BPMN}dataOutputAssociation")
                ],
            }
    lanes = []
    for lane in proc.iter(f"{_BPMN}lane"):
        refs = [r.text for r in lane.iter(f"{_BPMN}flowNodeRef")]
        for ref in refs:
            if ref in nodes:
                nodes[ref]["lane"] = lane.get("id")
        human = any(nodes.get(r, {}).get("kind") in ("userTask", "manualTask") for r in refs)
        lanes.append({"id": lane.get("id"), "name": lane.get("name") or "", "human": human})
    flows = [
        {"from": f.get("sourceRef"), "to": f.get("targetRef"), "name": f.get("name") or ""}
        for f in proc.iter(f"{_BPMN}sequenceFlow")
    ]
    return {"lanes": lanes, "nodes": list(nodes.values()), "flows": flows}
