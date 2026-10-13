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
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator

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
RUN_CONTAINER = "poc-run"

#: The manifest ships a registry placeholder so the file is not tied to one
#: OpenShift project. Submitting it would create a Job that dies on
#: ImagePullBackOff, so it is refused before anything is created — the same
#: check the shell script makes.
_IMAGE_PLACEHOLDER = "PROJECT_PLACEHOLDER"


class SandboxNotConfiguredError(RuntimeError):
    """Raised when the cluster client or the runner image is missing."""


def kubernetes_available() -> bool:
    return _K8S_AVAILABLE


def runner_image() -> str | None:
    image = os.getenv("WIZARD_POC_RUNNER_IMAGE", "").strip()
    return image or None


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

    def status(self, run_id: str) -> RunStatus:
        self._require_config()
        self._load_clients()
        job = self._batch.read_namespaced_job_status(
            name=job_name(run_id), namespace=self.namespace
        )
        return status_from_job(run_id, job)

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

        stream = self._core.read_namespaced_pod_log(
            name=pod,
            namespace=self.namespace,
            container=RUN_CONTAINER,
            follow=True,
            _preload_content=False,
        )
        for chunk in stream.stream():
            text = chunk.decode("utf-8", errors="replace") if isinstance(chunk, bytes) else chunk
            for line in text.splitlines():
                yield line

    def delete_run(self, run_id: str) -> None:
        """Remove a Job early. Finished Jobs reap themselves via ttlSecondsAfterFinished."""
        self._require_config()
        self._load_clients()
        self._batch.delete_namespaced_job(
            name=job_name(run_id), namespace=self.namespace, propagation_policy="Background"
        )
