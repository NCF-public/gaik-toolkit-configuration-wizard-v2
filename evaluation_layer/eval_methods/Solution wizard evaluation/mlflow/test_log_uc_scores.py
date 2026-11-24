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
        assert len({c.check_id for c in run.checks}) == len(run.checks) > 0
        assert [c for c in run.checks if not c.passed] == run.failed
    assert run_01.blueprint_digest and run_02.blueprint_digest
    assert run_01.blueprint_digest != run_02.blueprint_digest
    # The checks that moved between the two blueprints. This pins the current
    # UC02 verdicts: a corrected verdict in the workbook changes the list.
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
        for param in params:
            self.params[param.key] = param.value

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
    # What the run used, for grouping runs in MLflow.
    assert client.params["model.extraction_model"] == "gpt-5.4"
    assert client.params["model.provider"] == "azure_openai"


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
    for n, (sheet, _, _) in enumerate(m.QUESTIONS.values()):
        ws = wb.create_sheet(sheet)
        ws.append(header)
        ws.append([f"X-{n}", "Yes", "p", "e", "Yes", "g", "Yes", "g"])
    path = tmp_path / "UC99_comparison.xlsx"
    wb.save(path)
    m.read_checks(path)  # distinct ids on every sheet

    # The same id twice on one sheet, then on two sheets.
    wb["EQ2 Configuration"].append(["X-1", "Yes", "p", "e", "No", "g", "Yes", "g"])
    wb.save(path)
    with pytest.raises(ValueError, match="X-1 is on two rows"):
        m.read_checks(path)
    wb["EQ2 Configuration"].delete_rows(3)
    wb["EQ2 Configuration"].append(["X-0", "Yes", "p", "e", "No", "g", "Yes", "g"])
    wb.save(path)
    with pytest.raises(ValueError, match="X-0 is on two rows"):
        m.read_checks(path)


def test_every_check_metric_and_the_digest_tag_pass_mlflows_own_checks():
    # The fake client accepts any name; MLflow's server rejects a batch with a
    # bad name or over its size limits, so check with its own validation.
    from mlflow.entities import Metric, Param, RunTag
    from mlflow.utils.validation import _validate_batch_log_data

    for folder in sorted(p for p in m.USE_CASES.iterdir() if p.name[:2] == "UC"):
        for run in m.load_use_case(folder):
            metrics = [Metric(m.check_metric(c.check_id), 1.0, 0, 0) for c in run.checks]
            params = [Param(k, v) for k, v in run.labels.items()]
            _validate_batch_log_data(metrics, params, [RunTag(m.BLUEPRINT_DIGEST, "x")])


def test_a_failed_batch_deletes_the_half_logged_run():
    import pytest

    class FailingBatch(FakeClient):
        def log_batch(self, run_id, metrics=(), params=(), tags=()):
            raise RuntimeError("batch refused")

    run_01, _ = m.load_use_case(UC02)
    client = FailingBatch()
    with pytest.raises(RuntimeError, match="batch refused"):
        m.log(client, "1", run_01, trace_id=None)
    assert client.deleted and not client.terminated


def test_a_run_logged_before_the_check_metrics_is_named_for_replace(monkeypatch, capsys):
    import mlflow

    old_run = SimpleNamespace(
        info=SimpleNamespace(run_id="old"),
        data=SimpleNamespace(metrics={"eq1_requirement_recall": 1.0}),
    )

    class Client:
        def get_experiment_by_name(self, name):
            return SimpleNamespace(experiment_id="1")

    monkeypatch.setattr(mlflow, "MlflowClient", Client)
    monkeypatch.setattr(m, "find_replay_trace", lambda *a: None)
    monkeypatch.setattr(m, "existing_run", lambda *a: old_run)
    monkeypatch.setattr(sys, "argv", ["log_uc_scores.py", "--only", "UC02"])
    assert m.main() == 0
    out = capsys.readouterr().out
    assert out.count("log it again with --replace") == 2

    old_run.data.metrics["check.EQ1-R01"] = 1.0
    assert m.main() == 0
    assert "--replace" not in capsys.readouterr().out


def test_wizard_json_adds_the_wizards_version_and_model(tmp_path):
    import pytest

    assert m.wizard_settings(tmp_path / "wizard.json") == {}
    path = tmp_path / "wizard.json"
    path.write_text(
        json.dumps({"version": "wizard-v2-0.5.2", "agent_model": "claude-sonnet-5-5", "note": ""}),
        encoding="utf-8",
    )
    assert m.wizard_settings(path) == {
        "wizard.version": "wizard-v2-0.5.2",
        "wizard.agent_model": "claude-sonnet-5-5",
    }
    path.write_text("[]", encoding="utf-8")
    with pytest.raises(ValueError, match="not a JSON object"):
        m.wizard_settings(path)
