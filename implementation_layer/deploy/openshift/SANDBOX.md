# Sandbox PoC runs (S5-1 / #89)

`sandbox-job.yaml` runs one generated PoC as a Kubernetes Job. The PoC is code
the agent wrote from a user's description, so the Job treats it as untrusted:

| Setting | Why |
|---|---|
| `activeDeadlineSeconds: 600` | Hard 10-minute wall clock. A generated script that loops or waits for input is killed, not left holding a slot. |
| `backoffLimit: 0`, `restartPolicy: Never` | A failed run is a result the user should see once, not a flake to retry. |
| `automountServiceAccountToken: false` | The run cannot reach the Kubernetes API. |
| `runAsNonRoot`, `capabilities.drop: [ALL]`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true` | Nothing to escalate, nothing to write outside the scratch volumes. |
| `emptyDir` volumes only (`/workspace`, `/tmp`, with `sizeLimit`) | No `hostPath` and no PVC: the run touches no host directory and cannot see the api's session storage. |
| `networkpolicy-sandbox.yaml`: DNS, this stack's api on 8100 and TCP 443 to public addresses only; no ingress | Generated code cannot reach the database, the other stack, other services in the project or the cloud metadata address. |
| CPU/memory requests + limits on every container | One run cannot starve the api pod. |
| Only the model settings (`AZURE_API_KEY`, `AZURE_ENDPOINT`, `AZURE_API_VERSION`, `AZURE_DEPLOYMENT`) in the run container | The service token stays in the init container that fetches the package; the generated code never sees it. |

The PoC package arrives over HTTP from `wizard_api` (`GET /sessions/{id}/poc`),
not from a shared volume: the sessions PVC is ReadWriteOnce and is already
mounted by the api pod, so a second pod cannot mount it elsewhere.

Submit a run:

```bash
./scripts/submit-sandbox-job.sh <session-id> <runner-image>   # prints the Job name
DRY_RUN=1 ./scripts/submit-sandbox-job.sh <session-id> <img>  # render only
```

## Who may create a run

The api's ServiceAccount (`rbac.yaml`) may create Jobs. RBAC cannot say which
Job, so a container holding that token could create one that mounts the
project's Secrets. The api container runs the wizard agent and the scripts it
generates, so it gets no token (`automountServiceAccountToken: false`). The
token is mounted in the `sandbox-gate` sidecar alone (`wizard_api.sandbox_gate`,
localhost:8101). It takes a run (session, kind, case, user), renders the Job
from `sandbox-job.yaml` itself, and answers only the service token, which the
api keeps out of the agent's environment. The api reaches it through
`WIZARD_SANDBOX_GATE_URL`; without that variable `SandboxRunner` talks to the
cluster directly, as in local development.

A live Deployment gets the sidecar with `./deploy.sh sandbox-gate` (a patch,
so env vars set with `oc set env` stay), once its api image has the gate.

`implementation_layer/unit_tests/test_sandbox_job_manifest.py` asserts each row
of that table against the rendered manifest, so relaxing one fails the build.

The runner image needs Python plus whatever gaik extras the scaffolded PoC
imports, and `curl` for the fetch step. Building and publishing it belongs to
#91 (SandboxRunner), which calls this script.
