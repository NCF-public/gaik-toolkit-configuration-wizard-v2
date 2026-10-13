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
              Claude Agent SDK → Azure Foundry (secret wizard-v2-api-keys)
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
# edit secrets.yaml: DB creds/url + Foundry key + NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
oc apply -n "$PROJECT" -f secrets.yaml   # apply BEFORE the manifests
```

> **No secrets in git.** Only `secrets.yaml.example` (placeholders) is tracked.
> `postgres.yaml` contains no password field — the `wizard-v2-db` Secret comes
> from `secrets.yaml`. The DB pod stays pending until that Secret is applied.

## Deploy

```bash
export NEXT_PUBLIC_SUPABASE_URL=...        # baked into the web build
export NEXT_PUBLIC_SUPABASE_ANON_KEY=...
export NEXT_PUBLIC_DEV_AUTH=false          # true = built-in dev login only

./deploy.sh all        # manifests → api → web
# or step by step:
./deploy.sh manifests
./deploy.sh api
./deploy.sh web
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

## Environment variables

**wizard-v2-api** (runtime):

| Var | Source | Notes |
|-----|--------|-------|
| `WIZARD_DATABASE_URL` | secret `wizard-v2-db` / `database-url` | `postgresql+psycopg://…@wizard-v2-db:5432/wizard_v2` |
| `WIZARD_SESSION_OUTPUT_ROOT` | deployment | `/data/sessions` (PVC) |
| `CLAUDE_CODE_USE_FOUNDRY` | secret `wizard-v2-api-keys` | `1` in prod |
| `ANTHROPIC_FOUNDRY_API_KEY` | secret `wizard-v2-api-keys` | Azure Foundry key |
| `ANTHROPIC_FOUNDRY_RESOURCE` | secret `wizard-v2-api-keys` | `haagahelia-poc-gaik` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | secret `wizard-v2-api-keys` | e.g. `claude-sonnet-4-6` |

Without the Foundry secret the pod still starts (`optional: true`), but the
agent chat endpoint won't work.

**wizard-v2-web**: `WIZARD_API_URL` (runtime, → `http://wizard-v2-api:8100`),
`WIZARD_AGENT_CHAT=true` (live agent, not mock), `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`
(runtime secret). `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
`NEXT_PUBLIC_DEV_AUTH` are **build-time** args (baked into the bundle).

## Notes / open items

- **Health**: api uses `GET /health`; web has no `/api/health` route yet, so its
  probes are `tcpSocket:3000`. Add a real health route later for deeper checks.
- **Single replica**: `wizard-v2-api` is `Recreate` + RWO PVC + per-session live
  agent state — do not scale beyond 1 replica without moving session output to
  RWX/S3 (Allas) and externalising agent state.
- **Migrations** run on api startup (`alembic upgrade head`); the pod restarts
  until the DB is reachable.
- **Not wired into CI** — deployment is manual via `deploy.sh`, matching the
  demo app.
- **No test gate on deploy** — pushing a release tag deploys to staging
  regardless of CI status. Confirm CI is green before tagging.
- **RAHTI_TOKEN expiry** — the Rahti `oc login` / registry token (CSC
  service-account token, not stored in this repo) is **~1 year** long. Record
  its expiry date here and renew before then, or deploys silently stop working:
  - RAHTI_TOKEN expires: `TODO — fill from CSC` (created ~09/2026).
