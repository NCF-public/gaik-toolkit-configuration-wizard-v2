"""SandboxRunner: create a run, follow it, report where it got to (#91).

The Kubernetes client is faked so the whole lifecycle is exercised without a
cluster — what matters here is that the Job we submit is the one the reviewed
manifest describes, that output arrives during the run rather than at the end,
and that a run cut off at the deadline is not reported as a plain failure.
"""

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from wizard_api.services.sandbox_runner import (
    JOB_NAME_PREFIX,
    RUN_CONTAINER,
    SandboxNotConfiguredError,
    SandboxRunner,
    job_name,
    new_run_id,
    render_job_manifest,
    status_from_job,
)

IMAGE = "registry.example/gaik/wizard-v2-poc-runner:latest"
SESSION = "0b5b7b2b-a9ce-4896-b224-8d73614a9bb7"


# ---------------------------------------------------------------------------
# Run ids and names
# ---------------------------------------------------------------------------


def test_the_run_id_is_a_legal_job_name_component():
    rid = new_run_id(SESSION, now=datetime(2026, 9, 29, 8, 30, 0, tzinfo=UTC))

    assert rid == "20260929083000-614a9bb7"
    assert job_name(rid).startswith(JOB_NAME_PREFIX)
    # DNS-1123 label: lowercase alphanumerics and dashes only.
    assert all(c.islower() or c.isdigit() or c == "-" for c in job_name(rid))


def test_a_session_id_with_nothing_usable_still_yields_a_name():
    rid = new_run_id("///", now=datetime(2026, 9, 29, 8, 30, 0, tzinfo=UTC))

    assert rid == "20260929083000"


# ---------------------------------------------------------------------------
# The manifest we submit is the manifest that was reviewed
# ---------------------------------------------------------------------------


def test_the_rendered_job_keeps_the_isolation_the_manifest_sets():
    manifest = render_job_manifest(SESSION, "run-1", IMAGE)

    spec = manifest["spec"]
    assert spec["activeDeadlineSeconds"] == 600
    assert spec["backoffLimit"] == 0
    pod = spec["template"]["spec"]
    assert pod["restartPolicy"] == "Never"
    assert pod["automountServiceAccountToken"] is False
    assert pod["securityContext"]["runAsNonRoot"] is True
    # Scratch space only — no hostPath, no PVC.
    for volume in pod["volumes"]:
        assert set(volume) <= {"name", "emptyDir"}


def test_the_rendered_job_names_the_session_the_run_and_the_image():
    manifest = render_job_manifest(SESSION, "run-1", IMAGE)

    assert manifest["metadata"]["name"] == "wizard-v2-poc-run-run-1"
    assert manifest["metadata"]["labels"]["wizard-v2/session-id"] == SESSION
    images = {c["image"] for c in manifest["spec"]["template"]["spec"]["containers"]}
    images |= {c["image"] for c in manifest["spec"]["template"]["spec"]["initContainers"]}
    assert images == {IMAGE}


def _fetch_env(manifest):
    init = manifest["spec"]["template"]["spec"]["initContainers"][0]
    return {e["name"]: e for e in init["env"]}


def test_the_job_of_the_staging_stack_addresses_the_staging_api(monkeypatch):
    monkeypatch.delenv("WIZARD_INSTANCE_NAME", raising=False)
    env = _fetch_env(render_job_manifest(SESSION, "r1", IMAGE))

    assert env["WIZARD_API_URL"]["value"] == "http://wizard-v2-api:8100"
    assert env["WIZARD_API_TOKEN"]["valueFrom"]["secretKeyRef"]["name"] == "wizard-v2-token"


def test_the_job_of_a_second_stack_addresses_its_own_api_and_token(monkeypatch):
    """A Job from the s4 stack that fetched from wizard-v2-api would run the
    staging stack's session (or none), with the staging token."""
    monkeypatch.setenv("WIZARD_INSTANCE_NAME", "wizard-v2-s4")
    env = _fetch_env(render_job_manifest(SESSION, "r1", IMAGE))

    assert env["WIZARD_API_URL"]["value"] == "http://wizard-v2-s4-api:8100"
    assert env["WIZARD_API_TOKEN"]["valueFrom"]["secretKeyRef"]["name"] == "wizard-v2-s4-token"


def test_an_image_still_carrying_the_registry_placeholder_is_refused():
    """Submitting it would create a Job that dies on ImagePullBackOff — the
    same check the shell script makes, before anything exists in the cluster."""
    with pytest.raises(SandboxNotConfiguredError, match="placeholder"):
        render_job_manifest(SESSION, "run-1", "image-registry/PROJECT_PLACEHOLDER/runner:latest")


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


def _job(**status):
    return SimpleNamespace(status=SimpleNamespace(**status))


def test_a_finished_run_is_succeeded():
    assert status_from_job("r", _job(succeeded=1, conditions=[])).phase == "succeeded"


def test_a_running_run_is_running():
    assert status_from_job("r", _job(active=1, conditions=[])).phase == "running"


def test_a_run_that_has_not_started_is_pending():
    assert status_from_job("r", _job(conditions=[])).phase == "pending"


def test_a_deadline_is_reported_as_a_timeout_not_a_failure():
    """ "Your run was cut off at ten minutes" is a different thing to tell
    someone than "your PoC failed"."""
    job = _job(
        failed=1,
        conditions=[SimpleNamespace(type="Failed", reason="DeadlineExceeded", message="…")],
    )

    status = status_from_job("r", job)

    assert status.phase == "timeout"
    assert "ten-minute" in status.message


def test_a_real_failure_keeps_its_message():
    job = _job(
        failed=1,
        conditions=[SimpleNamespace(type="Failed", reason="BackoffLimitExceeded", message="boom")],
    )

    status = status_from_job("r", job)

    assert status.phase == "failed"
    assert status.message == "boom"


def test_finished_covers_every_terminal_phase():
    assert status_from_job("r", _job(succeeded=1, conditions=[])).finished
    assert not status_from_job("r", _job(active=1, conditions=[])).finished


# ---------------------------------------------------------------------------
# The lifecycle, against a fake cluster
# ---------------------------------------------------------------------------


class FakeBatch:
    def __init__(self, job=None):
        self.created: list[dict] = []
        self.deleted: list[str] = []
        self._job = job or _job(active=1, conditions=[])

    def create_namespaced_job(self, namespace, body):
        self.created.append({"namespace": namespace, "body": body})

    def read_namespaced_job_status(self, name, namespace):
        return self._job

    def delete_namespaced_job(self, name, namespace, propagation_policy):
        self.deleted.append(name)


class FakeLogStream:
    def __init__(self, chunks):
        self._chunks = chunks

    def stream(self):
        yield from self._chunks


class FakeCore:
    def __init__(self, chunks, pod_after=0):
        self._chunks = chunks
        self._calls = 0
        self._pod_after = pod_after
        self.log_args: dict = {}

    def list_namespaced_pod(self, namespace, label_selector):
        self._calls += 1
        if self._calls <= self._pod_after:
            return SimpleNamespace(items=[])
        return SimpleNamespace(items=[SimpleNamespace(metadata=SimpleNamespace(name="pod-1"))])

    def read_namespaced_pod_log(self, **kwargs):
        self.log_args = kwargs
        return FakeLogStream(self._chunks)


def _runner(batch=None, core=None):
    return SandboxRunner(
        namespace="gaik-staging", image=IMAGE, batch=batch or FakeBatch(), core=core or FakeCore([])
    )


def test_creating_a_run_submits_the_job_and_returns_its_id():
    batch = FakeBatch()

    run_id = _runner(batch=batch).create_run(SESSION)

    assert batch.created[0]["namespace"] == "gaik-staging"
    assert batch.created[0]["body"]["metadata"]["name"] == job_name(run_id)


def test_logs_arrive_line_by_line_while_the_run_is_going():
    """The acceptance criterion: incrementally, not only at completion."""
    core = FakeCore([b"loading pipeline\n", b"extracting\nwriting output\n"])

    lines = list(_runner(core=core).stream_logs("run-1"))

    assert lines == ["loading pipeline", "extracting", "writing output"]
    assert core.log_args["follow"] is True
    assert core.log_args["container"] == RUN_CONTAINER


def test_the_stream_waits_for_the_pod_to_be_scheduled():
    """A pod takes a moment to appear; that is not an error."""
    core = FakeCore([b"ready\n"], pod_after=2)

    lines = list(_runner(core=core).stream_logs("run-1", poll_seconds=0))

    assert lines == ["ready"]


def test_deleting_a_run_removes_its_job():
    batch = FakeBatch()

    _runner(batch=batch).delete_run("run-1")

    assert batch.deleted == [job_name("run-1")]


# ---------------------------------------------------------------------------
# Refusing to run half-configured
# ---------------------------------------------------------------------------


def test_a_missing_namespace_is_named_rather_than_guessed():
    runner = SandboxRunner(namespace=None, image=IMAGE, batch=FakeBatch(), core=FakeCore([]))

    with pytest.raises(SandboxNotConfiguredError, match="namespace"):
        runner.create_run(SESSION)


def test_a_missing_runner_image_is_named_rather_than_guessed():
    runner = SandboxRunner(namespace="x", image=None, batch=FakeBatch(), core=FakeCore([]))

    with pytest.raises(SandboxNotConfiguredError, match="runner image"):
        runner.create_run(SESSION)


# ---------------------------------------------------------------------------
# Finding the manifest (the #180 mistake, in a different file)
# ---------------------------------------------------------------------------


def test_the_manifest_is_found_in_a_checkout():
    from wizard_api.services.sandbox_runner import resolve_manifest

    found = resolve_manifest()

    assert found is not None
    assert found.name == "sandbox-job.yaml"


def test_an_explicit_manifest_path_wins(monkeypatch, tmp_path):
    from wizard_api.services.sandbox_runner import resolve_manifest

    elsewhere = tmp_path / "sandbox-job.yaml"
    elsewhere.write_text("kind: Job\n")
    monkeypatch.setenv("WIZARD_SANDBOX_MANIFEST", str(elsewhere))

    assert resolve_manifest() == elsewhere


def test_a_missing_manifest_names_the_variable_to_set(monkeypatch, tmp_path):
    """Path arithmetic from the module lands on "/" in the image — the mistake
    #180 was about. A deployment that keeps the manifest elsewhere says so."""
    from wizard_api.services import sandbox_runner

    monkeypatch.setenv("WIZARD_SANDBOX_MANIFEST", str(tmp_path / "nope.yaml"))

    with pytest.raises(SandboxNotConfiguredError, match="WIZARD_SANDBOX_MANIFEST"):
        sandbox_runner.render_job_manifest(SESSION, "run-1", IMAGE)
