"""A new session made from a session's export, to try a later phase again.

``python -m wizard_api.session_admin import <zip> --user <owner>`` reads a zip
that ``export`` (or ``GET /sessions/{id}/export``) wrote and makes a new session
from it: a new id and folder, with the step, gates, conversation, blueprint
versions and files of the exported one. The agent has no transcript under the
new id, so its first turn starts from the stored conversation
(``agent_service.restore_context_prompt``). Every import is a fresh copy, so one
export can be taken back to the same phase as often as needed. The answer on
storing usage data is not copied: the new session asks it again.

The zip is checked before anything is written: only ``session.json``, the AI
marker and files under ``files/`` are accepted, no entry may leave the new
folder or be a link, and the sizes are capped. Paths and ids of the exported
session inside its files are rewritten to the new session's, so nothing in the
copy points at the original.
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import uuid
import zipfile
from pathlib import PurePosixPath
from typing import Any

from sqlalchemy.orm import Session

from wizard_api.config import build_session_output_dir
from wizard_api.models import BlueprintVersion, WizardSession
from wizard_api.services import ai_marking, usage_caps
from wizard_api.services.session_export import _INTERNAL_METADATA, _LEFT_OUT
from wizard_api.session_state import (
    GATE_KEYS,
    RECORDING_NOT_ASKED,
    validate_gate_statuses,
    validate_step,
)
from wizard_api.storage import ensure_output_dir

MAX_ENTRIES = 20_000
MAX_TOTAL_BYTES = 2 * 1024**3
MAX_RECORD_BYTES = 50 * 1024**2
#: Files up to this size get the exported session's paths and id rewritten.
MAX_REWRITE_BYTES = 5 * 1024**2
_FILES = "files/"


class InvalidExportError(ValueError):
    """The archive is not a session export this service accepts."""


def _file_entries(archive: zipfile.ZipFile) -> list[tuple[zipfile.ZipInfo, str]]:
    """The entries under ``files/`` with their path in the session folder."""
    infos = archive.infolist()
    if len(infos) > MAX_ENTRIES:
        raise InvalidExportError(f"the archive has more than {MAX_ENTRIES} entries")
    if sum(info.file_size for info in infos) > MAX_TOTAL_BYTES:
        raise InvalidExportError("the archive is larger than allowed")
    names = [info.filename for info in infos]
    if len(names) != len(set(names)):
        raise InvalidExportError("the archive has a duplicate entry")
    entries = []
    for info in infos:
        name = info.filename
        if name in ("session.json", ai_marking.MARKER_FILE):
            continue
        if not name.startswith(_FILES):
            raise InvalidExportError(f"unexpected entry {name!r}")
        if info.is_dir():
            continue
        if stat.S_ISLNK(info.external_attr >> 16):
            raise InvalidExportError(f"{name!r} is a link")
        relative = name[len(_FILES) :]
        parts = PurePosixPath(relative).parts
        if (
            not relative
            or "\\" in relative
            or relative.startswith("/")
            or any(part in ("", ".", "..") for part in parts)
        ):
            raise InvalidExportError(f"unsafe path {name!r}")
        if _LEFT_OUT.intersection(parts):
            continue
        entries.append((info, relative))
    return entries


def _record(archive: zipfile.ZipFile) -> dict[str, Any]:
    try:
        info = archive.getinfo("session.json")
    except KeyError:
        raise InvalidExportError("the archive has no session.json") from None
    if info.file_size > MAX_RECORD_BYTES:
        raise InvalidExportError("session.json is larger than allowed")
    try:
        record = json.loads(archive.read(info))
    except (ValueError, UnicodeDecodeError) as exc:
        raise InvalidExportError("session.json is not valid JSON") from exc
    if not isinstance(record, dict):
        raise InvalidExportError("session.json is not an object")
    try:
        uuid.UUID(str(record.get("session_id")))
        step = record.get("step")
        if not isinstance(step, int) or isinstance(step, bool):
            raise ValueError("step is not a number")
        validate_step(step)
        gates = record.get("gate_statuses")
        if not isinstance(gates, dict) or set(gates) != set(GATE_KEYS):
            raise ValueError(f"gate_statuses must have exactly {', '.join(GATE_KEYS)}")
        validate_gate_statuses(gates)
        if not isinstance(record.get("metadata"), dict):
            raise ValueError("metadata is not an object")
        if not isinstance(record.get("user_id"), str):
            raise ValueError("user_id is not text")
        versions = record.get("blueprint_versions")
        if not isinstance(versions, list) or not versions:
            raise ValueError("there are no blueprint versions")
        numbers = []
        for version in versions:
            if not isinstance(version, dict):
                raise ValueError("a blueprint version is not an object")
            number = version.get("version")
            if not isinstance(number, int) or isinstance(number, bool) or number < 1:
                raise ValueError("a blueprint version has no valid number")
            if not isinstance(version.get("content"), dict):
                raise ValueError(f"blueprint version {number} has no content")
            if not isinstance(version.get("note", ""), str):
                raise ValueError(f"blueprint version {number} has a note that is not text")
            if version.get("draft") is not None and not isinstance(version["draft"], dict):
                raise ValueError(f"blueprint version {number} has a draft that is not an object")
            numbers.append(number)
        if len(numbers) != len(set(numbers)):
            raise ValueError("two blueprint versions have the same number")
        if record.get("active_version") not in numbers:
            raise ValueError("the active version is not among the blueprint versions")
    except ValueError as exc:
        raise InvalidExportError(f"session.json: {exc}") from exc
    return record


def _rewrite(text: str, replacements: list[tuple[str, str]]) -> str:
    for old, new in replacements:
        text = text.replace(old, new)
    return text


def _rewritten_json(value: Any, replacements: list[tuple[str, str]]) -> Any:
    return json.loads(_rewrite(json.dumps(value, ensure_ascii=False), replacements))


def _extract(
    archive: zipfile.ZipFile,
    entries: list[tuple[zipfile.ZipInfo, str]],
    folder: str,
    replacements: list[tuple[str, str]],
) -> None:
    root = os.path.realpath(folder)
    written = 0
    for info, relative in entries:
        target = os.path.realpath(os.path.join(root, *PurePosixPath(relative).parts))
        if os.path.commonpath([root, target]) != root:
            raise InvalidExportError(f"unsafe path {info.filename!r}")
        os.makedirs(os.path.dirname(target), exist_ok=True)
        if info.file_size <= MAX_REWRITE_BYTES:
            data = archive.read(info)
            written += len(data)
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError:
                pass
            else:
                data = _rewrite(text, replacements).encode("utf-8")
            with open(target, "xb") as out:
                out.write(data)
        else:
            with archive.open(info) as source, open(target, "xb") as out:
                while chunk := source.read(1024 * 1024):
                    written += len(chunk)
                    if written > MAX_TOTAL_BYTES:
                        raise InvalidExportError("the archive is larger than allowed")
                    out.write(chunk)
        if written > MAX_TOTAL_BYTES:
            raise InvalidExportError("the archive is larger than allowed")


def import_archive(
    db: Session, path: str | os.PathLike, user_id: str, *, title: str | None = None
) -> WizardSession:
    """A new session of ``user_id`` with what the exported session held."""
    try:
        archive = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise InvalidExportError(f"not a readable zip: {exc}") from exc
    with archive:
        record = _record(archive)
        entries = _file_entries(archive)
        old_id = str(record["session_id"])
        new_id = uuid.uuid4()
        folder = build_session_output_dir(user_id, new_id)
        old_folder = build_session_output_dir(record["user_id"], uuid.UUID(old_id))
        # The folder first: the bare id is part of it.
        replacements = [(old_folder, folder), (old_id, str(new_id))]

        metadata = {k: v for k, v in record["metadata"].items() if k not in _INTERNAL_METADATA}
        metadata = _rewritten_json(metadata, replacements)
        metadata.setdefault("messages", [])
        if title:
            metadata["title"] = title

        # The same place a new session takes: the user's limit on sessions in
        # progress applies (SessionLimitError), and a removed copy gives it back.
        usage_caps.claim_session(db, user_id)
        ensure_output_dir(folder)
        try:
            _extract(archive, entries, folder, replacements)
            session = WizardSession(
                id=new_id,
                user_id=user_id,
                step=record["step"],
                gate_statuses=dict(record["gate_statuses"]),
                session_metadata=metadata,
                output_dir=folder,
                active_version=record["active_version"],
                # The answer on storing usage data was given for the original
                # session; the copy asks again.
                aiops_recording=RECORDING_NOT_ASKED,
            )
            db.add(session)
            db.flush()
            for version in sorted(record["blueprint_versions"], key=lambda v: v["version"]):
                draft = version.get("draft")
                db.add(
                    BlueprintVersion(
                        session_id=new_id,
                        version=version["version"],
                        note=version.get("note", "")[:512],
                        content=_rewritten_json(version["content"], replacements),
                        draft=_rewritten_json(draft, replacements) if draft else None,
                    )
                )
            db.commit()
        except BaseException:
            db.rollback()
            shutil.rmtree(folder, ignore_errors=True)
            raise
    db.refresh(session)
    return session
