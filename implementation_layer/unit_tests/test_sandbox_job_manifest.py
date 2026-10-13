"""The sandbox Job's isolation settings (S5-1 / #89).

The PoC this Job runs is code an agent generated from a user's description, so
the isolation is the feature, not a detail. These tests read the rendered
manifest and fail if any of it is weakened — a manifest is easy to relax by
accident and nothing else would notice.
"""

import subprocess
from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")

OPENSHIFT_DIR = Path(__file__).resolve().parents[1] / "deploy" / "openshift"
TEMPLATE = OPENSHIFT_DIR / "sandbox-job.yaml"
SUBMIT = OPENSHIFT_DIR / "scripts" / "submit-sandbox-job.sh"
SESSION_ID = "7f3a9c21-0000-4000-8000-abc123456789"
IMAGE = "registry.example.invalid/wizard-v2-poc-runner:test"


@pytest.fixture(scope="module")
def job() -> dict:
    """The manifest as submit-sandbox-job.sh renders it."""
    out = subprocess.run(
        [str(SUBMIT), SESSION_ID, IMAGE],
        capture_output=True,
        text=True,
        check=True,
        env={"DRY_RUN": "1", "PATH": "/usr/bin:/bin"},
    )
    return yaml.safe_load(out.stdout)


@pytest.fixture(scope="module")
def pod_spec(job: dict) -> dict:
    return job["spec"]["template"]["spec"]


def test_rendering_leaves_no_placeholders(job: dict) -> None:
    rendered = yaml.safe_dump(job)
    assert "PLACEHOLDER" not in rendered
    assert job["metadata"]["labels"]["wizard-v2/session-id"] == SESSION_ID


def test_run_is_killed_after_ten_minutes(job: dict) -> None:
    assert job["spec"]["activeDeadlineSeconds"] == 600


def test_a_failed_run_is_not_retried(job: dict, pod_spec: dict) -> None:
    assert job["spec"]["backoffLimit"] == 0
    assert pod_spec["restartPolicy"] == "Never"


def test_every_container_declares_cpu_and_memory_limits(pod_spec: dict) -> None:
    containers = pod_spec["containers"] + pod_spec.get("initContainers", [])
    assert containers
    for c in containers:
        limits = c["resources"]["limits"]
        assert limits["cpu"], c["name"]
        assert limits["memory"], c["name"]


def test_the_poc_cannot_reach_the_kubernetes_api(pod_spec: dict) -> None:
    assert pod_spec["automountServiceAccountToken"] is False


def test_containers_run_unprivileged_as_non_root(pod_spec: dict) -> None:
    assert pod_spec["securityContext"]["runAsNonRoot"] is True
    for c in pod_spec["containers"] + pod_spec.get("initContainers", []):
        sc = c["securityContext"]
        assert sc["allowPrivilegeEscalation"] is False, c["name"]
        assert sc["readOnlyRootFilesystem"] is True, c["name"]
        assert sc["capabilities"]["drop"] == ["ALL"], c["name"]
        assert not sc.get("privileged"), c["name"]


def test_nothing_from_the_host_or_the_cluster_storage_is_mounted(pod_spec: dict) -> None:
    """The acceptance criterion: a run touches no host filesystem.

    Scratch space is emptyDir, which lives and dies with the pod. A hostPath
    would expose a node directory, and a PVC would hand the run the api's
    session storage.
    """
    for volume in pod_spec["volumes"]:
        assert set(volume) <= {"name", "emptyDir"}, volume
        assert volume["emptyDir"]["sizeLimit"], volume["name"]


def test_the_run_container_gets_no_cluster_secrets_beyond_the_model_key(
    pod_spec: dict,
) -> None:
    """The service token belongs to the fetch step, not to the generated code."""
    run = next(c for c in pod_spec["containers"] if c["name"] == "poc-run")
    secret_keys = {
        e["valueFrom"]["secretKeyRef"]["key"]
        for e in run["env"]
        if "valueFrom" in e and "secretKeyRef" in e["valueFrom"]
    }
    assert secret_keys == {"AZURE_API_KEY"}


def test_the_run_container_starts_the_entrypoint_the_scaffolder_writes(
    pod_spec: dict,
) -> None:
    """``poc_service._PACKAGE_ENTRYPOINT`` is ``run_poc.py``, and the templates
    under ``solution_wizard/templates/poc/`` all render that name. A manifest
    naming anything else fails every run at once, before the PoC's own code has
    a chance to be wrong."""
    run = next(c for c in pod_spec["containers"] if c["name"] == "poc-run")
    assert run["command"] == ["python", "run_poc.py"]
    assert run["workingDir"] == "/workspace/poc"
