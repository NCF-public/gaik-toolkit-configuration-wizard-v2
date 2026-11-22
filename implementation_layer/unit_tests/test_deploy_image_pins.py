"""deploy.sh names the wizard's images by digest, never by a moving tag.

A Deployment that names ``:latest`` starts whatever was pushed last whenever its
pod restarts. ``deploy.sh pin`` pins a stack to what it runs now, and a rollback
tag moves it on purpose. These tests run deploy.sh against a stand-in ``oc``
that answers from a small fixed project and records every call.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")

DEPLOY = Path(__file__).resolve().parents[1] / "deploy" / "openshift" / "deploy.sh"
REGISTRY = "image-registry.apps.2.rahti.csc.fi"
PROJECT = "proj"

FAKE_OC = r"""
import json, os, re, sys

state = json.load(open(os.environ["FAKE_OC_STATE"]))
args = sys.argv[1:]
with open(os.environ["FAKE_OC_LOG"], "a") as log:
    log.write(json.dumps(args) + "\n")

def out(text):
    sys.stdout.write(text)
    sys.exit(0)

def arg_after(flag):
    return args[args.index(flag) + 1] if flag in args else ""

jsonpath = next((a[len("-o=jsonpath="):] if a.startswith("-o=") else a[len("jsonpath="):]
                 for a in args if a.startswith("jsonpath=")), "")
named = re.search(r'@\.name==\\?"([^"\\]+)', jsonpath)

if args[:1] == ["whoami"]:
    out("tester\n")
if args[:2] == ["get", "istag"]:
    digest = state["istags"].get(args[2])
    if digest:
        out(digest)
    sys.exit(1)
if args[:2] == ["get", "isimage"]:
    sys.exit(0 if args[2] in state["images"] else 1)
if args[:2] == ["get", "pods"]:
    app = arg_after("-l").split("=", 1)[1]
    ids = state["running"].get(app, {}).get(named.group(1), [])
    out("".join(i + "\n" for i in ([ids] if isinstance(ids, str) else ids)))
if args[:1] == ["get"] and args[1].startswith("deployment/"):
    d = state["deployments"].get(args[1].split("/", 1)[1])
    if d is None:
        sys.exit(1)
    if not jsonpath:
        out("")
    if "WIZARD_POC_RUNNER_IMAGE" in jsonpath:
        out(d.get("runner", ""))
    if "containers[0]" in jsonpath:
        out(next(iter(d["containers"].values())))
    if "[*]" in jsonpath:
        out("".join(f"{c}={image}\n" for c, image in d["containers"].items()))
    out(d["containers"].get(named.group(1), ""))
if args[:1] == ["apply"]:
    with open(os.environ["FAKE_OC_LOG"] + ".applied", "a") as applied:
        applied.write("---\n" + sys.stdin.read() + "\n")
    sys.exit(0)
if args[:1] in (["rollout"], ["set"]):
    sys.exit(0)
sys.stderr.write("fake oc: unexpected call " + " ".join(args) + "\n")
sys.exit(2)
"""


def image(repo: str, ref: str) -> str:
    sep = "@" if ref.startswith("sha256:") else ":"
    return f"{REGISTRY}/{PROJECT}/{repo}{sep}{ref}"


def s4_project(runner_repo: str = "wizard-v2-s4-poc-runner") -> dict:
    return {
        "deployments": {
            "wizard-v2-s4-api": {
                "containers": {
                    "wizard-v2-s4-api": image("wizard-v2-s4-api", "latest"),
                    "agent": image("wizard-v2-s4-api", "latest"),
                },
                "runner": image(runner_repo, "gaik-0.11.1"),
            },
            "wizard-v2-s4-web": {
                "containers": {"wizard-v2-s4-web": image("wizard-v2-s4-web", "latest")}
            },
        },
        "running": {
            "wizard-v2-s4-api": {
                "wizard-v2-s4-api": image("wizard-v2-s4-api", "sha256:a1"),
                "agent": image("wizard-v2-s4-api", "sha256:a1"),
            },
            "wizard-v2-s4-web": {"wizard-v2-s4-web": image("wizard-v2-s4-web", "sha256:w1")},
        },
        "istags": {
            f"{runner_repo}:gaik-0.11.1": "sha256:r1",
            "wizard-v2-s4-api:pre-0.5.2": "sha256:a0",
            "wizard-v2-s4-web:pre-0.5.2": "sha256:w0",
        },
        "images": [
            "wizard-v2-s4-api@sha256:a1",
            "wizard-v2-s4-api@sha256:a0",
            "wizard-v2-s4-web@sha256:w1",
            "wizard-v2-s4-web@sha256:w0",
        ],
    }


def run_deploy(tmp_path: Path, state: dict, *args: str) -> tuple[subprocess.CompletedProcess, list]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    oc = bin_dir / "oc"
    oc.write_text(f"#!{sys.executable}\n{FAKE_OC}")
    oc.chmod(0o755)
    (tmp_path / "state.json").write_text(json.dumps(state))
    log = tmp_path / "oc.log"
    log.write_text("")
    result = subprocess.run(
        ["bash", str(DEPLOY), *args],
        capture_output=True,
        text=True,
        env={
            "PROJECT": PROJECT,
            "INSTANCE": "s4",
            "PATH": f"{bin_dir}{os.pathsep}/usr/bin:/bin",
            "FAKE_OC_STATE": str(tmp_path / "state.json"),
            "FAKE_OC_LOG": str(log),
        },
    )
    calls = [json.loads(line) for line in log.read_text().splitlines()]
    return result, calls


def changes(calls: list) -> list:
    return [c for c in calls if c[0] in ("set", "rollout") and c[1] != "status"]


def test_pin_keeps_the_stack_on_the_images_its_pods_run(tmp_path: Path) -> None:
    result, calls = run_deploy(tmp_path, s4_project(), "pin")
    assert result.returncode == 0, result.stderr
    api = "deployment/wizard-v2-s4-api"
    web = "deployment/wizard-v2-s4-web"
    assert changes(calls) == [
        ["rollout", "pause", api, "-n", PROJECT],
        ["set", "image", api, "-n", PROJECT, f"*={image('wizard-v2-s4-api', 'sha256:a1')}"],
        [
            "set",
            "env",
            api,
            "-n",
            PROJECT,
            "-c",
            "wizard-v2-s4-api",
            f"WIZARD_POC_RUNNER_IMAGE={image('wizard-v2-s4-poc-runner', 'sha256:r1')}",
        ],
        ["rollout", "resume", api, "-n", PROJECT],
        ["rollout", "pause", web, "-n", PROJECT],
        ["set", "image", web, "-n", PROJECT, f"*={image('wizard-v2-s4-web', 'sha256:w1')}"],
        ["rollout", "resume", web, "-n", PROJECT],
    ]


def test_pin_to_a_tag_moves_the_api_and_web_to_that_build(tmp_path: Path) -> None:
    result, calls = run_deploy(tmp_path, s4_project(), "pin", "pre-0.5.2")
    assert result.returncode == 0, result.stderr
    set_images = [c[-1] for c in calls if c[:2] == ["set", "image"]]
    assert set_images == [
        f"*={image('wizard-v2-s4-api', 'sha256:a0')}",
        f"*={image('wizard-v2-s4-web', 'sha256:w0')}",
    ]


def test_a_runner_from_another_stacks_repository_stays_in_that_repository(
    tmp_path: Path,
) -> None:
    # Staging's api has run the s4 runner image; pinning freezes it, it does not
    # switch the stack to a runner repository that has no image.
    result, calls = run_deploy(
        tmp_path, s4_project(runner_repo="wizard-v2-poc-runner-other"), "pin"
    )
    assert result.returncode == 0, result.stderr
    runner = [c[-1] for c in calls if c[:2] == ["set", "env"]]
    assert runner == [f"WIZARD_POC_RUNNER_IMAGE={image('wizard-v2-poc-runner-other', 'sha256:r1')}"]


@pytest.mark.parametrize("missing", ["image", "pod", "agreement"])
def test_nothing_changes_when_there_is_no_digest_to_pin_to(tmp_path: Path, missing: str) -> None:
    state = s4_project()
    if missing == "image":
        state["images"].remove("wizard-v2-s4-api@sha256:a1")
    elif missing == "pod":
        del state["running"]["wizard-v2-s4-api"]
    else:
        # A rollout still going: an old pod and a new one, on different images.
        state["running"]["wizard-v2-s4-api"]["wizard-v2-s4-api"] = [
            image("wizard-v2-s4-api", "sha256:a0"),
            image("wizard-v2-s4-api", "sha256:a1"),
        ]
    result, calls = run_deploy(tmp_path, state, "pin")
    assert result.returncode != 0
    assert changes(calls) == []


def test_applying_the_manifests_keeps_the_digests_the_live_stack_names(tmp_path: Path) -> None:
    state = s4_project()
    api = state["deployments"]["wizard-v2-s4-api"]
    pinned_api = image("wizard-v2-s4-api", "sha256:a1")
    pinned_runner = image("wizard-v2-s4-poc-runner", "sha256:r1")
    api["containers"] = {"wizard-v2-s4-api": pinned_api, "agent": pinned_api}
    api["runner"] = pinned_runner
    pinned_scanner = image("wizard-v2-s4-scanner", "sha256:s1")
    state["deployments"]["wizard-v2-s4-scanner"] = {"containers": {"clamd": pinned_scanner}}
    result, _ = run_deploy(tmp_path, state, "manifests")
    assert result.returncode == 0, result.stderr
    applied = list(yaml.safe_load_all((tmp_path / "oc.log.applied").read_text()))
    by_name = {
        (d["kind"], d["metadata"]["name"]): d
        for d in applied
        if isinstance(d, dict) and "metadata" in d
    }

    def images(name: str) -> list[str]:
        spec = by_name[("Deployment", name)]["spec"]["template"]["spec"]
        return [c["image"] for c in spec["containers"]]

    assert images("wizard-v2-s4-api") == [pinned_api, pinned_api]
    assert images("wizard-v2-s4-scanner") == [pinned_scanner]
    # The web app still names :latest live, so its manifest is applied as it is.
    assert images("wizard-v2-s4-web") == [image("wizard-v2-s4-web", "latest")]
    # The Service in the scanner's file goes through as well.
    assert ("Service", "wizard-v2-s4-scanner") in by_name
    runner_env = [
        e["value"]
        for c in by_name[("Deployment", "wizard-v2-s4-api")]["spec"]["template"]["spec"][
            "containers"
        ]
        for e in c.get("env", [])
        if e["name"] == "WIZARD_POC_RUNNER_IMAGE"
    ]
    assert runner_env == [pinned_runner]
