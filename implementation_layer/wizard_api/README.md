# Wizard API (S1-1 + S1-3 + S1-2 + S1-12)

FastAPI service for Solution Wizard V2 session persistence.

**Issues:** #5 S1-1 · #7 S1-3 · #6 S1-2 · #8 S1-12 · #9 S1-5 · #10 UI wire · #11 tests

## Quick start — Docker Compose (Sprint 1 demo)

```bash
cd implementation_layer/wizard_api
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=dev-compose-encryption-key-32chars!!
docker compose up --build
```

| Service | URL |
|---------|-----|
| UI | http://localhost:3000 |
| API | http://localhost:8100/health |
| Postgres | localhost:5432 (`wizard` / `wizard`) |

Set `NEXT_PUBLIC_DEV_AUTH=true` in the UI container for dev login (`dev@gaik.local`).

## Local API only (without Docker UI)

```bash
cd implementation_layer/wizard_api
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
docker compose up -d postgres   # or use existing Postgres
alembic upgrade head
uvicorn wizard_api.main:app --reload --port 8100
```

Wire the UI:

```bash
# solution_wizard_v2/.env.local
WIZARD_API_URL=http://localhost:8100
NEXT_PUBLIC_DEV_AUTH=true
```

## Session API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions` | Create (`user_id`, optional `title`, `metadata`) — seeds blueprint v1 |
| `GET` | `/sessions?user_id=` | List sessions |
| `GET` | `/sessions/{id}` | Full session detail (blueprint, versions, messages) |
| `PATCH` | `/sessions/{id}` | Update `step`, `gate_statuses`, `metadata` |
| `POST` | `/sessions/{id}/messages` | Append chat messages (Sprint 1 stub) |
| `POST` | `/sessions/{id}/versions` | New blueprint version |

Steps are **1–13** (matches V2 UI phase stepper). Gate keys: `gate_1` … `gate_4`.

## Output directory (S1-5)

On create, the API sets and creates:

`$WIZARD_SESSION_OUTPUT_ROOT/<user_id>/<session_id>/`

## Tests

```bash
# Postgres required (docker compose up -d postgres)
pytest

# Full stack in Docker (API + UI + E2E)
./scripts/docker-test.sh
```

Persistence tests skip automatically if Postgres is unavailable.  
`test_persistence_restart.py` simulates a new API process (fresh app instance, same Postgres) per #11 / US-S1-01.

## Model

- `wizard_sessions` — step, gates, metadata (title, messages, status), `active_version`, `output_dir`
- `blueprint_versions` — versioned blueprint JSON per session
