## Quick start

### Option A — Docker (full stack) — **recommended (persistence + BPMN)**

This is the path for demos and review: Postgres sessions, BPMN through wizard_api.

```bash
cd implementation_layer/wizard_api
./scripts/dev-stack.sh
```

Or the earlier way:

```bash
cd implementation_layer/wizard_api
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=dev-compose-encryption-key-32chars!!
docker compose up --build
```

UI http://localhost:3000 · API http://localhost:8100

**Stop:** `docker compose down` (data is kept in the volumes)  
**Logs:** `docker compose logs -f wizard-ui` / `wizard-api`

---

## Manual testing (Sprint 1 demo)

### 1. Start

```bash
cd implementation_layer/wizard_api
./scripts/dev-stack.sh
```

Check:
- http://localhost:8100/health → `{"status":"ok","version":"…"}`
- http://localhost:3000/login → sign-in page

### 2. Sign in

| Field | Value |
|--------|------|
| Email | Password |
|------------|----------|
| `dev@gaik.local` | `gaik` |
| `dev2@gaik.local` | `gaik2` |

In the Docker stack `NEXT_PUBLIC_DEV_AUTH=true` — no Supabase.

### 3. New session (US-S1-01)

1. On the home page: type a session name → **Start new**
2. The wizard view opens (chat + workspace + steps)
3. Click **Next step →** a couple of times
4. Type a chat message → **Send** — a mock reply should appear (SSE)

### 4. Continue later (persistence)

1. Close the tab or the browser
2. Open http://localhost:3000 again and sign in
3. The session shows in the **Previous sessions** list
4. Open the session → same step, chat and blueprint

### 5. API restart (as in the #11 test)

```bash
cd implementation_layer/wizard_api
docker compose restart wizard-api
# wait ~5 s, open the session again in the browser
```

The state should be kept in Postgres.

### 6. API directly (optional)

```bash
# Create a session
curl -s -X POST http://localhost:8100/sessions \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"dev@gaik.local","title":"curl-testi"}' | jq .

# Fetch (replace SESSION_ID)
curl -s http://localhost:8100/sessions/SESSION_ID | jq .
```

### 7. Mock mode vs. API mode

| Environment | `WIZARD_API_URL` | Sessions | Persistence + BPMN edit |
|-----------|------------------|---------|--------------------------|
| Docker Compose (`dev-stack.sh`) — **recommended** | set | Postgres, UUID sessions | ✅ the right path (demo / review) |
| Local API + UI | `http://localhost:8100` | Postgres | ✅ same as Docker |
| `npm run dev` without the API (**UI-only**) | no | In-memory mock (`ses_chatbot` etc.) | ❌ does not meet the product requirement |

**Product requirement** (session storage + editable BPMN ↔ JSON): always **API mode**.  
UI-only is the old Sprint 1 shortcut for trying out the UI — not for demos, not for customer review.

**Stack E2E** (Postgres + both users + API restart): `cd implementation_layer/wizard_api && ./scripts/docker-test.sh --step stack-e2e`

### 8. Troubleshooting

| Problem | Fix |
|---------|----------|
| Port 5432 in use | `docker ps` — stop the other Postgres or `POSTGRES_HOST_PORT=5433 docker compose up` |
| UI does not load | `docker compose logs wizard-ui` |
| Empty session list in API mode | Normal the first time — create a new session |
| Chat does not reply | Make sure you are signed in; production UI in Docker (not `next dev`) |
| BPMN “Failed to load” / 500 in UI-only | Run `./scripts/setup.sh` (`.venv` + pydantic) **or** use API mode (`WIZARD_API_URL`) — recommended: API |
| BPMN OK in API mode, 500 in UI-only | Expected without setup: UI-only spawns `python3` + `solution_wizard`; the API generates the BPMN itself |

---

### Option B — Local dev (API + UI separately)

```bash
# 1. Backend
cd implementation_layer/wizard_api
./scripts/setup.sh          # once
./scripts/dev-api.sh        # Postgres + API on :8100

# 2. Frontend (new terminal)
cd implementation_layer/solution_wizard_v2
./scripts/setup.sh          # once (npm + .venv/pydantic for BPMN scripts)
cp .env.example .env.local
# Edit .env.local: NEXT_PUBLIC_DEV_AUTH=true and WIZARD_API_URL=http://localhost:8100
npm run dev                 # http://localhost:3000
```

### Option B2 — UI only (`npm run dev`, mock sessions) — not for demos

**Do not use for demos or customer review.** UI-only has no Postgres persistence;
the “real” save path for BPMN edits is wizard_api.

Without `WIZARD_API_URL`, Next spawns Python
(`scripts/generate_bpmn_from_v2.py` → `solution_wizard` + **pydantic**).
The system `/usr/bin/python3` often lacks pydantic → 500 / “Failed to load BPMN”.

If you still need UI-only for trying out the UI locally:

```bash
cd implementation_layer/solution_wizard_v2
./scripts/setup.sh          # npm ci + .venv + pip install -r requirements-bpmn.txt
cp .env.example .env.local
# Edit .env.local: NEXT_PUBLIC_DEV_AUTH=true; leave WIZARD_API_URL commented out
npm run dev
```

Optional: `WIZARD_BPMN_PYTHON=/path/to/python` (with pydantic installed).  
In API mode (`WIZARD_API_URL` set) the UI does **not** spawn Python for BPMN — generation is in wizard_api.

### Option C — One script (API + UI, no Docker UI image)

```bash
cd implementation_layer
./wizard_dev.sh
```

Login (dev): `dev@gaik.local` / `gaik`

---

## Tests

### All tests in Docker (recommended before PR)

Run in **your own terminal** so output streams live (Cursor agent runs may look stuck):

```bash
cd implementation_layer/wizard_api
./scripts/docker-test.sh
```

Progress lines look like `[08:24:01] >>> Backend tests (pytest)` with elapsed seconds on each step.
First image build (npm + Playwright) can take several minutes — later runs use cache.

Run one stage only:

```bash
./scripts/docker-test.sh --step api    # pytest
./scripts/docker-test.sh --step ui     # vitest + lint + build
./scripts/docker-test.sh --step e2e    # Playwright (starts mock UI, polls health every 5s)
```

From the UI package:

```bash
cd implementation_layer/solution_wizard_v2
npm run test:docker
```

### Local (without Docker test images)

```bash
# Backend unit/integration (needs Postgres on :5432)
cd implementation_layer/wizard_api
pytest -v

# Frontend unit tests
cd implementation_layer/solution_wizard_v2
npm run test

# Frontend E2E (Playwright, mock mode)
npm run test:e2e

# All UI tests
npm run test:all
```

CI runs `.github/workflows/solution-wizard-v2.yml` on changes to wizard_api / solution_wizard_v2.

---

## Lint

```bash
cd implementation_layer/solution_wizard_v2
npm run lint

cd implementation_layer/wizard_api
ruff check . && ruff format --check .
```

---

## Security

See [docs/SECURITY.md](solution_wizard_v2/docs/SECURITY.md).
