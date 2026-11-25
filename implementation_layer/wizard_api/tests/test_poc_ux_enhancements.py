"""Tests for PoC UX enhancements: expected inputs, synthetic samples, and Next.js starter."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from wizard_api.services import input_content, nextjs_starter, poc_service


def _make_poc(tmp_path: Path, *, inputs: list[dict] | None = None, with_app: bool = True) -> Path:
    poc = tmp_path / "poc"
    (poc / "sample_input").mkdir(parents=True)
    (poc / "ui").mkdir(parents=True)
    if with_app:
        (poc / "app.py").write_text("# test page server\n", encoding="utf-8")
    descriptor = {
        "id": "audio_pdf_report",
        "name": "Audio and PDF report",
        "purpose": "Combine Finnish recordings and PDF documents into a report.",
        "language": "fi",
        "pattern": "hybrid",
        "inputs": inputs
        if inputs is not None
        else [
            {
                "kind": "audio",
                "label": "Äänite",
                "extensions": [".wav", ".mp3", ".m4a", ".ogg"],
                "multiple": True,
            },
            {
                "kind": "document",
                "label": "Asiakirja",
                "extensions": [".pdf", ".docx", ".doc"],
                "multiple": True,
            },
        ],
        "asks_question": False,
        "output_fields": [
            {"key": "summary", "label": "Yhteenveto", "type": "string"},
            {"key": "findings", "label": "Havainnot", "type": "list"},
        ],
        "steps": [
            {"id": "s1", "title": "Litteroi äänite", "kind": "ai", "component": "Transcriber"},
            {"id": "s2", "title": "Pura PDF", "kind": "ai", "component": "MultimodalParser"},
        ],
    }
    (poc / "ui" / "solution.json").write_text(
        json.dumps(descriptor, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return poc


def test_expected_poc_inputs_reads_hybrid_slots_and_filters_to_uploadable_extensions(
    tmp_path: Path,
):
    poc = _make_poc(tmp_path)
    draft = {"technical_spec": {"input_types": ["audio", "pdf", "docx"]}}

    slots = poc_service.expected_poc_inputs(str(poc), draft)
    assert [s["kind"] for s in slots] == ["audio", "document"]
    # .ogg and .doc are not accepted by input_content.check so they are filtered out
    assert slots[0]["extensions"] == [".wav", ".mp3", ".m4a"]
    assert slots[0]["can_synthesize"] is False
    assert slots[1]["extensions"] == [".pdf", ".docx"]
    assert slots[1]["can_synthesize"] is True


def test_expected_poc_inputs_falls_back_to_draft_contract_when_solution_json_missing(
    tmp_path: Path,
):
    poc = tmp_path / "poc"
    poc.mkdir()
    draft = {"technical_spec": {"input_types": ["audio", "document"]}}

    slots = poc_service.expected_poc_inputs(str(poc), draft)
    # "document" (pdf/docx/txt/md) stays a single document slot, not split into document + text.
    assert [s["kind"] for s in slots] == ["audio", "document"]
    assert slots[0]["can_synthesize"] is False
    assert slots[1]["can_synthesize"] is True
    assert ".pdf" in slots[1]["extensions"] and ".txt" in slots[1]["extensions"]


def test_create_synthetic_sample_writes_valid_pdf_not_marked_uploaded(tmp_path: Path):
    poc = _make_poc(tmp_path)
    draft = {"technical_spec": {"input_types": ["audio", "pdf"]}}

    created = poc_service.create_synthetic_sample(str(poc), draft, kind="document")
    assert created["name"] == "example_document.pdf"
    assert created["uploaded"] is False
    assert created["kind"] == "document"

    written = poc / "sample_input" / created["name"]
    data = written.read_bytes()
    assert data.startswith(b"%PDF-1.4")
    # Must pass the exact same upload content & active-content PDF checks.
    assert input_content.check(created["name"], data, input_content.allowed_kinds(draft)) == "pdf"

    listed = poc_service.list_sample_inputs(str(poc))
    assert listed == [{"name": "example_document.pdf", "bytes": len(data), "uploaded": False}]


def test_create_synthetic_sample_refuses_audio_only(tmp_path: Path):
    poc = _make_poc(
        tmp_path,
        inputs=[
            {"kind": "audio", "label": "Äänite", "extensions": [".wav", ".mp3"], "multiple": False}
        ],
    )
    draft = {"technical_spec": {"input_types": ["audio"]}}

    with pytest.raises(poc_service.InputRejectedError):
        poc_service.create_synthetic_sample(str(poc), draft)

    with pytest.raises(poc_service.InputRejectedError):
        poc_service.create_synthetic_sample(str(poc), draft, kind="audio")


def test_create_synthetic_sample_table_csv(tmp_path: Path):
    poc = _make_poc(
        tmp_path,
        inputs=[
            {
                "kind": "table",
                "label": "Taulukko",
                "extensions": [".csv", ".xlsx"],
                "multiple": True,
            }
        ],
    )
    draft = {"technical_spec": {"input_types": ["csv"]}}

    created = poc_service.create_synthetic_sample(str(poc), draft, kind="table")
    assert created["name"] == "example_table.csv"
    assert created["uploaded"] is False
    data = (poc / "sample_input" / created["name"]).read_bytes()
    assert input_content.check(created["name"], data, input_content.allowed_kinds(draft)) == "csv"


def test_nextjs_starter_supports_check_and_generated_files(tmp_path: Path):
    poc_without_app = _make_poc(tmp_path / "no_app", with_app=False)
    assert nextjs_starter.supports_nextjs_starter(str(poc_without_app)) is False

    poc = _make_poc(tmp_path / "with_app", with_app=True)
    assert nextjs_starter.supports_nextjs_starter(str(poc)) is True

    files = dict(nextjs_starter.frontend_files(str(poc)))
    expected_paths = {
        "frontend/package.json",
        "frontend/tsconfig.json",
        "frontend/next.config.ts",
        "frontend/postcss.config.mjs",
        "frontend/.env.example",
        "frontend/.gitignore",
        "frontend/README.md",
        "frontend/AGENT_PROMPT.md",
        "frontend/lib/poc-backend.ts",
        "frontend/app/layout.tsx",
        "frontend/app/globals.css",
        "frontend/app/page.tsx",
        "frontend/app/api/solution/route.ts",
        "frontend/app/api/status/route.ts",
        "frontend/app/api/run/route.ts",
        "frontend/app/api/files/[runId]/[...path]/route.ts",
        "frontend/components/solution-runner.tsx",
    }
    assert expected_paths.issubset(set(files))

    pkg = json.loads(files["frontend/package.json"])
    assert pkg["name"] == "audio-pdf-report-frontend"
    assert "next" in pkg["dependencies"]
    assert "-H 127.0.0.1" in pkg["scripts"]["dev"]
    assert "-H 127.0.0.1" in pkg["scripts"]["start"]
    assert "MAX_UPLOAD_BYTES" in files["frontend/app/api/run/route.ts"]
    assert "isLocalSameOriginRequest" in files["frontend/app/api/run/route.ts"]

    # Security boundary: starter never creates a route proxying /api/source.
    assert not any("source" in path for path in files)
    for rel, content in files.items():
        if rel.startswith("frontend/app/api/"):
            assert "/api/source" not in content

    # Agent handoff prompt names the use case and its modalities.
    assert "Audio and PDF report" in files["frontend/AGENT_PROMPT.md"]
    assert "Äänite" in files["frontend/AGENT_PROMPT.md"]
    assert os.sep not in next(iter(files)) or os.sep == "/"


def test_nextjs_starter_writes_cleanly_into_deployable_zip(tmp_path: Path):
    import io
    import zipfile

    poc = _make_poc(tmp_path, with_app=True)
    buf = io.BytesIO()
    made_from: dict[str, dict[str, str]] = {}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel_path, content in nextjs_starter.frontend_files(str(poc)).items():
            zf.writestr(rel_path, content)
            made_from[rel_path] = {"made_from": "nextjs_starter"}
    with zipfile.ZipFile(io.BytesIO(buf.getvalue())) as zf:
        names = set(zf.namelist())
        assert "frontend/package.json" in names
        assert "frontend/AGENT_PROMPT.md" in names
        assert "frontend/app/api/run/route.ts" in names
        assert not any("source" in n for n in names)
    assert made_from["frontend/package.json"] == {"made_from": "nextjs_starter"}


def test_create_synthetic_sample_clears_uploaded_flag_and_reads_solution_name_without_draft(
    tmp_path: Path,
):
    poc = _make_poc(tmp_path)
    # Simulate user previously uploading a file with the same name.
    poc_service.save_sample_input(
        str(poc), "example_document.pdf", poc_service._minimal_pdf_bytes("Old", ["line"])
    )
    assert poc_service.list_sample_inputs(str(poc))[0]["uploaded"] is True

    # draft=None should still read the solution name from ui/solution.json.
    created = poc_service.create_synthetic_sample(str(poc), None, kind="document")
    assert created["name"] == "example_document.pdf"
    assert created["uploaded"] is False
    listed = poc_service.list_sample_inputs(str(poc))
    assert listed[0]["uploaded"] is False
    raw = (poc / "sample_input" / created["name"]).read_bytes()
    assert b"Audio and PDF report" in raw
