# GAIK Solution Wizard V2 — Rahti 2 deployment (staging)

OpenShift/Rahti 2 manifests + deploy script for the V2 stack:

- **wizard-v2-web** — `solution_wizard_v2` (Next.js), public HTTPS route.
- **wizard-v2-api** — `wizard_api` (FastAPI) + live V1 agent, ClusterIP only.
- **wizard-v2-db** — Postgres (`pgvector/pgvector:pg17`) with a PVC.
- PVCs for the DB and for generated session output.

Modelled on `implementation_layer/toolkit_demo_app/openshift/` (same registry,
buildx schema2 requirement, SSE route annotations).

> **Target: a separate staging project.** The manifests omit `namespace:` on
> purpose — `oc project` / `oc apply -n <project>` decides placement, and
> `deploy.sh` substitutes the project into the image references. The staging
> project must be created and access granted (CSC / infra) before deploying.

## Architecture

```
Internet ──HTTPS──▶ Route (wizard-v2-web)
                       │
                       ▼
                  wizard-v2-web (Next.js :3000)
                       │  server-side proxy, WIZARD_API_URL
                       ▼
                  wizard-v2-api (FastAPI :8100) ──▶ wizard-v2-db (:5432, PVC)
                       │                          └▶ /data/sessions (PVC)
                       ▼
              Claude Agent SDK → Azure Foundry (secret gaik-demo-api-keys)
```

## One-time setup

```bash
oc login https://api.2.rahti.csc.fi:6443
export PROJECT=<your-staging-project>
oc project "$PROJECT"
```

Fill in secrets (all real values live here, never in tracked YAML):

```bash
cd implementation_layer/deploy/openshift
cp secrets.yaml.example secrets.yaml     # secrets.yaml is gitignored
# edit secrets.yaml: DB creds/url, service token, NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
./deploy.sh secrets                      # apply BEFORE the manifests
```

> **No secrets in git.** Only `secrets.yaml.example` (placeholders) is tracked.
> `postgres.yaml` contains no password field — the `wizard-v2-db` Secret comes
> from `secrets.yaml`. The DB pod stays pending until that Secret is applied.
>
> Model-provider keys (Foundry for the agent, Azure OpenAI for sandbox runs)
> come from the **project-wide** Secret `gaik-demo-api-keys`, shared with the
> demo app. It is not part of `secrets.yaml`; `deployment-api.yaml` and
> `sandbox-job.yaml` read it as `optional: true`.

## Deploy

```bash
export NEXT_PUBLIC_SUPABASE_URL=...        # baked into the web build
export NEXT_PUBLIC_SUPABASE_ANON_KEY=...
export NEXT_PUBLIC_DEV_AUTH=false          # true = built-in dev login only

./deploy.sh all        # manifests → api → web → poc-runner
# or step by step:
./deploy.sh manifests
./deploy.sh api
./deploy.sh web
./deploy.sh poc-runner
./deploy.sh verify
```

`deploy.sh` builds single-arch `linux/amd64` Docker schema2 images straight to
the registry (`--output type=registry,oci-mediatypes=false`) via a
`docker-container` buildx builder — the same dance the demo app needs because
Rahti's registry rejects Docker's default OCI manifest output.

The public URL is auto-assigned (`route.yaml` omits `spec.host`):

```bash
oc get route wizard-v2-web -n "$PROJECT" -o jsonpath='{.spec.host}'
```

## What the api may do in the cluster (rbac.yaml)

`rbac.yaml` gives each instance's api its own ServiceAccount (`wizard-v2[-s4]-api`)
and a Role limited to what the sandbox runner does: create and read Jobs, read
pods and pod logs. No `secrets`. `deploy.sh manifests` applies it first. Before
this the api ran as the namespace's default account, which either could not
create Jobs at all or, where that account had been given `edit`, could read every
Secret in the project.

## Two instances in one project

Every resource name is built from `NAME_PLACEHOLDER`, which `deploy.sh`
substitutes with `wizard-v2` (the staging stack) or `wizard-v2-<INSTANCE>`.
That covers the Deployments, Services, Route, PVCs, the db/web/token Secrets,
the container names and the **image repositories** — two stacks sharing one
`:latest` tag would otherwise pull each other's build on the next restart.
What stays shared is the project-wide `gaik-demo-api-keys` Secret and the
Supabase project.

To run a second code line (say sprint4) next to staging, with its own database,
session storage, images and URL:

```bash
export PROJECT=<the same project>
export INSTANCE=s4                         # lowercase letters, digits, dashes

# once: its own secrets (fresh password + token; the same secrets.yaml copy
# works, deploy.sh substitutes the instance into the names and the DB host)
./deploy.sh secrets

# from the branch to deploy (deploy.sh refuses an unpushed commit):
./deploy.sh all
./deploy.sh verify                         # route: wizard-v2-s4-web-<project>.2.rahtiapp.fi
```

`./deploy.sh render <manifest>` prints any manifest exactly as it would be
applied, without a cluster; `implementation_layer/unit_tests/test_deploy_instances.py`
renders every manifest for both instances and fails on any name that is not
instance-scoped.

Before the first second instance: add its route host to the Supabase project's
redirect URLs, and check the project quota has room for another Postgres, api
and web pod plus sandbox Jobs (`oc describe quota -n "$PROJECT"`).

**Known gap (#91 follow-up):** `sandbox-job.yaml` is rendered by the api at run
time, not by `deploy.sh`, and still names `wizard-v2-api` and `wizard-v2-token`
outright. A second instance's sandbox Jobs would fetch the PoC package from the
staging api. The api now exports `WIZARD_INSTANCE_NAME` so the sandbox runner
can render its own prefix into the Job.

From CI (`.github/workflows/wizard-v2-deploy.yml`): a tag push deploys the
staging stack; a second instance is deployed by *Run workflow* from the branch
to deploy, with the `instance` input set.

## Environment variables

**wizard-v2-api** (runtime):

| Var | Source | Notes |
|-----|--------|-------|
| `WIZARD_INSTANCE_NAME` | deployment | resource-name prefix of this stack (`wizard-v2` or `wizard-v2-<instance>`) |
| `WIZARD_DATABASE_URL` | secret `wizard-v2-db` / `database-url` | `postgresql+psycopg://…@wizard-v2-db:5432/wizard_v2` |
| `WIZARD_SESSION_OUTPUT_ROOT` | deployment | `/data/sessions` (PVC) |
| `WIZARD_API_TOKEN` | secret `wizard-v2-token` | service token, same value on web (#135) |
| `CLAUDE_CODE_USE_FOUNDRY` | secret `gaik-demo-api-keys` | `1` in prod |
| `ANTHROPIC_FOUNDRY_API_KEY` | secret `gaik-demo-api-keys` | Azure Foundry key |
| `ANTHROPIC_FOUNDRY_RESOURCE` | secret `gaik-demo-api-keys` | `haagahelia-poc-gaik` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | secret `gaik-demo-api-keys` | e.g. `claude-sonnet-4-6` |
| `AZURE_API_KEY` | secret `gaik-demo-api-keys` | Azure OpenAI key for the agent's own tool calls (Phase 4 `generate_schema.py` → GAIK SchemaGenerator) |
| `AZURE_ENDPOINT` | secret `gaik-demo-api-keys` | `https://<resource>.openai.azure.com/` |
| `AZURE_API_VERSION` | secret `gaik-demo-api-keys` | optional, gaik default otherwise |
| `AZURE_DEPLOYMENT` | secret `gaik-demo-api-keys` | optional, gaik default deployment otherwise |

Without the Foundry secret the pod still starts (`optional: true`), but the
agent chat endpoint won't work. Without the `AZURE_*` values the chat works but
the agent stops at Phase 4: `generate_schema.py` needs them (and the `gaik`
package the api image installs) to generate the extraction schema.

**wizard-v2-web**: `WIZARD_API_URL` (runtime, → `http://wizard-v2-api:8100`),
`WIZARD_AGENT_CHAT=true` (live agent, not mock), `WIZARD_API_TOKEN` and
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (runtime secrets). `NEXT_PUBLIC_SUPABASE_URL`
/ `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_DEV_AUTH` are **build-time**
args (baked into the bundle).

## Notes / open items

- **Health**: api uses `GET /health`; web has no `/api/health` route yet, so its
  probes are `tcpSocket:3000`. Add a real health route later for deeper checks.
- **Single replica**: `wizard-v2-api` is `Recreate` + RWO PVC + per-session live
  agent state — do not scale beyond 1 replica without moving session output to
  RWX/S3 (Allas) and externalising agent state.
- **Migrations** run on api startup (`alembic upgrade head`); the pod restarts
  until the DB is reachable.
- **No test gate on deploy** — pushing a release tag deploys to staging
  regardless of CI status. Confirm CI is green before tagging.
- **RAHTI_TOKEN expiry** — the Rahti `oc login` / registry token (CSC
  service-account token, not stored in this repo) is **~1 year** long. Record
  its expiry date here and renew before then, or deploys silently stop working:
  - RAHTI_TOKEN expires: `TODO — fill from CSC` (created ~09/2026).
