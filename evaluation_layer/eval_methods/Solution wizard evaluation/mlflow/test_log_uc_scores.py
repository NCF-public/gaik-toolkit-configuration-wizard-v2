"""Tests for log_uc_scores.py, without an MLflow server.

uv run --with pytest --with openpyxl --with "mlflow-skinny==3.17.*" \
    pytest -q -o addopts="" test_log_uc_scores.py
"""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

import log_uc_scores as m  # noqa: E402

UC02 = next(m.USE_CASES.glob("UC02*"))


def test_the_digest_names_the_content_not_its_layout(tmp_path):
    a, b, c = tmp_path / "a.json", tmp_path / "b.json", tmp_path / "c.json"
    a.write_text(json.dumps({"x": 1, "y": [1, 2]}), encoding="utf-8")
    b.write_text('{\n  "y": [1, 2],\n  "x": 1\n}\n', encoding="utf-8")
    c.write_text(json.dumps({"x": 2, "y": [1, 2]}), encoding="utf-8")
    assert m.blueprint_digest(a) == m.blueprint_digest(b)
    assert m.blueprint_digest(a) != m.blueprint_digest(c)
    assert m.blueprint_digest(tmp_path / "missing.json") is None
    broken = tmp_path / "broken.json"
    broken.write_text('{"x": 1', encoding="utf-8")
    assert m.blueprint_digest(broken) is None


def test_each_uc02_run_has_every_scored_check_and_its_own_blueprint():
    run_01, run_02 = m.load_use_case(UC02)
    for run in (run_01, run_02):
        assert len(run.checks) == sum(run.checks_per_question.values())
        assert [c for c in run.checks if not c.passed] == run.failed
    assert run_01.blueprint_digest and run_02.blueprint_digest
    assert run_01.blueprint_digest != run_02.blueprint_digest
    # The checks that moved between the two blueprints.
    result_01 = {c.check_id: c.passed for c in run_01.checks}
    result_02 = {c.check_id: c.passed for c in run_02.checks}
    moved = sorted(k for k in result_01 if result_01[k] != result_02[k])
    assert moved == ["EQ1-R32", "EQ1-R40"]


class FakeClient:
    """Records what log() sends, in place of MlflowClient."""

    def __init__(self):
        self.tags, self.metrics, self.params = {}, {}, {}
        self.terminated = self.deleted = False

    def create_run(self, experiment_id, run_name, tags):
        self.tags = dict(tags)
        return SimpleNamespace(info=SimpleNamespace(run_id="r1"))

    def log_metric(self, run_id, key, value):
        self.metrics[key] = value

    def log_param(self, run_id, key, value):
        self.params[key] = value

    def log_batch(self, run_id, metrics=(), params=(), tags=()):
        for metric in metrics:
            self.metrics[metric.key] = metric.value

    def set_terminated(self, run_id):
        self.terminated = True

    def delete_run(self, run_id):
        self.deleted = True


def test_a_logged_run_has_one_metric_per_check_and_the_blueprint_digest():
    run_01, _ = m.load_use_case(UC02)
    client = FakeClient()
    m.log(client, "1", run_01, trace_id=None)

    assert client.terminated and not client.deleted
    assert client.tags[m.BLUEPRINT_DIGEST] == run_01.blueprint_digest
    checks = {k: v for k, v in client.metrics.items() if k.startswith("check.")}
    assert len(checks) == len(run_01.checks)
    assert checks["check.EQ1-R32"] == 0.0
    assert checks["check.EQ1-R40"] == 1.0
    # The headline scores are still there.
    assert client.metrics["eq1_requirement_recall"] == run_01.scores["EQ1"]


def test_a_run_without_a_blueprint_file_is_logged_without_the_tag():
    run_01, _ = m.load_use_case(UC02)
    run_01.blueprint_digest = None
    client = FakeClient()
    m.log(client, "1", run_01, trace_id=None)
    assert m.BLUEPRINT_DIGEST not in client.tags
    assert client.terminated


def test_a_check_on_two_rows_stops_the_script(tmp_path):
    import pytest
    from openpyxl import Workbook

    header = ["Check ID", "Scored?", "Oracle parameter", "Oracle expected value"]
    header += [f"Run {n} {what}" for n in (1, 2) for what in ("verdict", "generated value")]
    wb = Workbook()
    wb.remove(wb.active)
    for sheet, _, _ in m.QUESTIONS.values():
        ws = wb.create_sheet(sheet)
        ws.append(header)
        ws.append(["X-01", "Yes", "p", "e", "Yes", "g", "Yes", "g"])
    wb["EQ2 Configuration"].append(["X-01", "Yes", "p", "e", "No", "g", "Yes", "g"])
    path = tmp_path / "UC99_comparison.xlsx"
    wb.save(path)
    with pytest.raises(ValueError, match="X-01 is on two rows"):
        m.read_checks(path)
