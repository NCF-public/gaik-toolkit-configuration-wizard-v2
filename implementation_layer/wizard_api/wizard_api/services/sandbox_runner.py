"""Run a generated PoC package in an isolated sandbox Job (#91).

The manifest stays the single source of truth for what a run is allowed to do:
this renders `deploy/openshift/sandbox-job.yaml` exactly as
`scripts/submit-sandbox-job.sh` does, then submits it through the Kubernetes API
rather than shelling out to `oc`. The api container has no `oc` binary, and
following a pod's log needs the API anyway, so the script stays for hand-runs
and this is the path the UI uses.

The Kubernetes client is optional, like the Claude SDK in agent_service: the
module imports and its pure parts are testable without a cluster, and the parts
that need one raise a clear error instead of failing at import.
"""

from __future__ import annotations

import os
import re
import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

try:  # pragma: no cover - exercised only where the cluster client is installed
    from kubernetes import client as k8s_client
    from kubernetes import config as k8s_config
    from kubernetes import watch as k8s_watch

    _K8S_AVAILABLE = True
except ImportError:  # pragma: no cover - the common case in unit tests
    k8s_client = k8s_config = k8s_watch = None  # type: ignore[assignment]
    _K8S_AVAILABLE = False

import yaml

_HERE = Path(__file__).resolve()
_MANIFEST_RELATIVE = Path("deploy") / "openshift" / "sandbox-job.yaml"


def resolve_manifest() -> Path | None:
    """Locate sandbox-job.yaml (env override wins).

    Not a fixed number of `parents[...]`: in a checkout this file sits four
    levels below implementation_layer, and in the image it sits at
    /app/wizard_api/services, where that same arithmetic lands on "/" — the
    mistake #180 was about, in a different file. Each candidate is checked for
    existence instead, and a deployment that has the manifest somewhere else
    sets the variable.
    """
    env = os.getenv("WIZARD_SANDBOX_MANIFEST", "").strip()
    if env:
        return Path(env)

    def ancestor(levels: int, *parts: str | Path) -> Path | None:
        """`_HERE` has fewer ancestors in the image than in a checkout, and
        indexing past the root raises rather than returning nothing."""
        parents = _HERE.parents
        if levels >= len(parents):
            return None
        return parents[levels].joinpath(*parts)

    candidates = (
        # Installed image: the Dockerfile copies the manifest beside the app.
        Path("/manifests/sandbox-job.yaml"),
        # Checkout: …/wizard_api/wizard_api/services → implementation_layer.
        ancestor(3, _MANIFEST_RELATIVE),
        # Editable install from the repo root.
        ancestor(4, "implementation_layer", _MANIFEST_RELATIVE),
    )
    for candidate in candidates:
        if candidate is not None and candidate.is_file():
            return candidate
    return None


JOB_NAME_PREFIX = "wizard-v2-poc-run-"

#: How long the run container may take to start once its pod exists: the init
#: container's package fetch plus, on a node that has not seen it yet, the pull
#: of the runner image (hundreds of MB). Separate from the 120 s wait for the pod
#: itself, which it used to share. The Job's own activeDeadlineSeconds bounds the
#: run proper.
CONTAINER_START_TIMEOUT_SECONDS = 300
RUN_CONTAINER = "poc-run"

#: The manifest ships a registry placeholder so the file is not tied to one
#: OpenShift project. Submitting it would create a Job that dies on
#: ImagePullBackOff, so it is refused before anything is created — the same
#: check the shell script makes.
_IMAGE_PLACEHOLDER = "PROJECT_PLACEHOLDER"


#: Label the manifest puts on every Job (and its pod) naming the session it runs.
SESSION_LABEL = "wizard-v2/session-id"


class SandboxNotConfiguredError(RuntimeError):
    """Raised when the cluster client or the runner image is missing."""


class RunNotFoundError(LookupError):
    """The run does not exist, or belongs to another session.

    One error for both, like the 404 for a session that is not the caller's:
    a caller must not be able to tell a stranger's run from a missing one.
    """


def kubernetes_available() -> bool:
    return _K8S_AVAILABLE


def runner_image() -> str | None:
    image = os.getenv("WIZARD_POC_RUNNER_IMAGE", "").strip()
    return image or None


def instance_name() -> str:
    """Resource-name prefix of this stack (``wizard-v2`` or ``wizard-v2-<instance>``).

    deploy.sh sets it on the api Deployment; the Job addresses its own stack's api
    Service and token Secret with it.
    """
    return os.getenv("WIZARD_INSTANCE_NAME", "").strip() or "wizard-v2"


def sandbox_namespace() -> str | None:
    """The project the Jobs go into. In-cluster this is the pod's own namespace."""
    explicit = os.getenv("WIZARD_SANDBOX_NAMESPACE", "").strip()
    if explicit:
        return explicit
    token_ns = Path("/var/run/secrets/kubernetes.io/serviceaccount/namespace")
    if token_ns.is_file():
        return token_ns.read_text(encoding="utf-8").strip() or None
    return None


def new_run_id(session_id: str, now: datetime | None = None) -> str:
    """A DNS-1123-safe run id, matching submit-sandbox-job.sh.

    Job names are DNS-1123 labels, so the session id contributes only its
    lowercase alphanumerics and only its last eight characters — enough to tell
    two sessions apart in `oc get jobs` without making the name illegal.
    """
    stamp = (now or datetime.now(UTC)).strftime("%Y%m%d%H%M%S")
    tail = re.sub(r"[^a-z0-9]", "", session_id.lower())[-8:]
    return f"{stamp}-{tail}" if tail else stamp


def job_name(run_id: str) -> str:
    return f"{JOB_NAME_PREFIX}{run_id}"


def render_job_manifest(
    session_id: str,
    run_id: str,
    image: str,
    template: Path | None = None,
) -> dict[str, Any]:
    """The Job for one run, rendered from the manifest the reviewer approved.

    Substitution is textual and identical to the shell script's `sed`, so the
    two paths cannot drift into producing different Jobs from the same file.
    """
    path = template or resolve_manifest()
    if path is None or not path.is_file():
        raise SandboxNotConfiguredError(
            "sandbox Job manifest not found — set WIZARD_SANDBOX_MANIFEST to "
            "deploy/openshift/sandbox-job.yaml"
        )
    if _IMAGE_PLACEHOLDER in image:
        raise SandboxNotConfiguredError(
            "the runner image still carries the registry placeholder; set "
            "WIZARD_POC_RUNNER_IMAGE to the image you built"
        )

    text = path.read_text(encoding="utf-8")
    for placeholder, value in (
        ("SESSION_ID_PLACEHOLDER", session_id),
        ("RUN_ID_PLACEHOLDER", run_id),
        ("IMAGE_PLACEHOLDER", image),
        ("NAME_PLACEHOLDER", instance_name()),
    ):
        text = text.replace(placeholder, value)
    return yaml.safe_load(text)


@dataclass(frozen=True)
class RunStatus:
    """Where a run got to. `phase` is what the UI shows."""

    run_id: str
    phase: str  # pending | running | succeeded | failed | timeout | unknown
    exit_code: int | None = None
    message: str | None = None

    @property
    def finished(self) -> bool:
        return self.phase in {"succeeded", "failed", "timeout"}


def status_from_job(run_id: str, job: Any) -> RunStatus:
    """Read a Job's status the way the user needs to hear it.

    A Job that hit `activeDeadlineSeconds` reports failure with a distinct
    reason, and "your run was cut off at ten minutes" is a different thing to
    tell someone than "your PoC failed", so the two are not collapsed.
    """
    status = getattr(job, "status", None)
    if status is None:
        return RunStatus(run_id, "unknown")

    for condition in getattr(status, "conditions", None) or []:
        if getattr(condition, "type", None) == "Failed":
            reason = getattr(condition, "reason", "") or ""
            if reason == "DeadlineExceeded":
                return RunStatus(
                    run_id,
                    "timeout",
                    message="the run passed its ten-minute limit and was stopped",
                )
            return RunStatus(run_id, "failed", message=getattr(condition, "message", None))

    if getattr(status, "succeeded", None):
        return RunStatus(run_id, "succeeded", exit_code=0)
    if getattr(status, "failed", None):
        return RunStatus(run_id, "failed")
    if getattr(status, "active", None):
        return RunStatus(run_id, "running")
    return RunStatus(run_id, "pending")


def _run_container_state(pod: Any) -> str:
    """``started`` (running or already finished), ``never`` (the pod failed
    before the run container could start), or ``waiting``."""
    status = getattr(pod, "status", None)
    for container in getattr(status, "container_statuses", None) or []:
        if getattr(container, "name", None) != RUN_CONTAINER:
            continue
        state = getattr(container, "state", None)
        if getattr(state, "running", None) or getattr(state, "terminated", None):
            return "started"
    if getattr(status, "phase", None) == "Failed":
        return "never"
    return "waiting"


class SandboxRunner:
    """Creates sandbox Jobs and follows their output.

    `client` is injectable so the tests can drive the whole lifecycle without a
    cluster; in production it is built from the in-cluster service account.
    """

    def __init__(
        self,
        *,
        namespace: str | None = None,
        image: str | None = None,
        batch: Any = None,
        core: Any = None,
        template: Path | None = None,
    ) -> None:
        self.namespace = namespace or sandbox_namespace()
        self.image = image or runner_image()
        self.template = template
        self._batch = batch
        self._core = core

    # -- wiring ---------------------------------------------------------------

    def _require_config(self) -> None:
        if self.namespace is None:
            raise SandboxNotConfiguredError(
                "no sandbox namespace — set WIZARD_SANDBOX_NAMESPACE, or run in-cluster"
            )
        if not self.image:
            raise SandboxNotConfiguredError(
                "no runner image — set WIZARD_POC_RUNNER_IMAGE to the image built by "
                "deploy.sh poc-runner"
            )

    def _load_clients(self) -> None:
        if self._batch is not None and self._core is not None:
            return
        if not _K8S_AVAILABLE:
            raise SandboxNotConfiguredError(
                "the kubernetes client is not installed (pip install 'wizard-api[sandbox]')"
            )
        try:
            k8s_config.load_incluster_config()
        except Exception:  # noqa: BLE001 - falls back to a developer kubeconfig
            k8s_config.load_kube_config()
        self._batch = self._batch or k8s_client.BatchV1Api()
        self._core = self._core or k8s_client.CoreV1Api()

    # -- lifecycle ------------------------------------------------------------

    def create_run(self, session_id: str, *, run_id: str | None = None) -> str:
        """Submit one run and return its id. The Job fetches the package itself."""
        self._require_config()
        self._load_clients()
        rid = run_id or new_run_id(session_id)
        manifest = render_job_manifest(session_id, rid, self.image, self.template)
        self._batch.create_namespaced_job(namespace=self.namespace, body=manifest)
        return rid

    def status(self, run_id: str, *, session_id: str | None = None) -> RunStatus:
        """Where a run got to. With ``session_id``, only if that session started it."""
        self._require_config()
        self._load_clients()
        job = self._read_job(run_id)
        if session_id is not None:
            self._require_run_of(job, run_id, session_id)
        return status_from_job(run_id, job)

    def final_status(
        self, run_id: str, *, wait_seconds: float = 30.0, poll_seconds: float = 1.0
    ) -> RunStatus:
        """The status once the Job has settled, for the end of a log stream.

        The log of a finished run ends the moment its container exits; the Job's
        own ``status`` follows a second or two later, once the controller has
        seen the pod finish. Reading it right at the end of the log returned
        ``running`` for a run that had succeeded: the stream's closing frame said
        the run was still going, and ``last_successful_run`` was never recorded,
        so the deployable package never opened from a live run (it did when the
        stream was attached afterwards). Wait, bounded, for a terminal phase.
        """
        deadline = time.monotonic() + wait_seconds
        while True:
            status = self.status(run_id)
            if status.finished or time.monotonic() >= deadline:
                return status
            time.sleep(poll_seconds)

    def check_run_of_session(self, run_id: str, session_id: str) -> None:
        """Raise ``RunNotFoundError`` unless ``session_id`` started this run (B3, #143).

        The Job carries the session in its ``wizard-v2/session-id`` label, set
        from the manifest at creation. Without this check a run id is just a
        string the caller chose: a successful run of one session could be
        recorded as the successful run of another, which is what opens the
        deployable download.
        """
        self.status(run_id, session_id=session_id)

    def _read_job(self, run_id: str) -> Any:
        try:
            return self._batch.read_namespaced_job_status(
                name=job_name(run_id), namespace=self.namespace
            )
        except Exception as exc:  # noqa: BLE001 - only the 404 is interpreted here
            if getattr(exc, "status", None) == 404:
                raise RunNotFoundError(run_id) from exc
            raise

    @staticmethod
    def _require_run_of(job: Any, run_id: str, session_id: str) -> None:
        metadata = getattr(job, "metadata", None)
        labels = getattr(metadata, "labels", None) or {}
        if labels.get(SESSION_LABEL) != session_id:
            raise RunNotFoundError(run_id)

    def _run_pod(self, run_id: str) -> str | None:
        pods = self._core.list_namespaced_pod(
            namespace=self.namespace, label_selector=f"job-name={job_name(run_id)}"
        )
        items = getattr(pods, "items", None) or []
        return getattr(items[0].metadata, "name", None) if items else None

    def stream_logs(self, run_id: str, *, poll_seconds: float = 1.0) -> Iterator[str]:
        """Yield log lines as the run produces them.

        The acceptance criterion is that output arrives *during* the run, not at
        the end, so this follows the pod's log rather than reading it once the
        Job is done. A pod takes a moment to be scheduled, so the wait for one
        is part of the stream instead of an error.
        """
        self._require_config()
        self._load_clients()

        pod = None
        deadline = time.monotonic() + 120
        while pod is None and time.monotonic() < deadline:
            pod = self._run_pod(run_id)
            if pod is None:
                time.sleep(poll_seconds)
        if pod is None:
            raise SandboxNotConfiguredError(f"no pod appeared for run {run_id}")
        self._wait_for_run_container(
            pod, run_id, poll_seconds, time.monotonic() + CONTAINER_START_TIMEOUT_SECONDS
        )

        stream = self._core.read_namespaced_pod_log(
            name=pod,
            namespace=self.namespace,
            container=RUN_CONTAINER,
            follow=True,
            _preload_content=False,
        )
        for chunk in stream.stream():
            text = chunk.decode("utf-8", errors="replace") if isinstance(chunk, bytes) else chunk
            yield from text.splitlines()

    def _wait_for_run_container(
        self, pod: str, run_id: str, poll_seconds: float, deadline: float
    ) -> None:
        """Hold the stream until the run container exists as a process.

        A pod is listed as soon as it is scheduled, but its log can be read only
        once the init container (the package fetch) has finished and ``poc-run``
        has started; before that the cluster answers 400 ``PodInitializing``.
        The UI opens the stream the moment a run is created, so it always landed
        in that window, got the error, and never reached the status check that
        records a successful run (#143) — the Job completed, the session never
        learned it. The wait belongs to the stream, like the wait for the pod.
        """
        while True:
            state = _run_container_state(self._core.read_namespaced_pod(pod, self.namespace))
            if state == "started":
                return
            if state == "never":
                raise SandboxNotConfiguredError(
                    f"run {run_id} did not start: its package fetch step failed"
                )
            if time.monotonic() >= deadline:
                raise SandboxNotConfiguredError(
                    f"the run container of {run_id} did not start in time"
                )
            time.sleep(poll_seconds)

    def delete_run(self, run_id: str) -> None:
        """Remove a Job early. Finished Jobs reap themselves via ttlSecondsAfterFinished."""
        self._require_config()
        self._load_clients()
        self._batch.delete_namespaced_job(
            name=job_name(run_id), namespace=self.namespace, propagation_policy="Background"
        )
