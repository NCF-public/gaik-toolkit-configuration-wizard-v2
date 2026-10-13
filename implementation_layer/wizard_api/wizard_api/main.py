import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from wizard_api import config
from wizard_api.routers.sessions import router as sessions_router
from wizard_api.security import ServiceTokenMiddleware
from wizard_api.services import agent_service

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not config.service_auth_enabled():
        logger.warning(
            "WIZARD_API_TOKEN is not set - service authentication is DISABLED. "
            "Any caller able to reach this API can read and modify any user's "
            "sessions. Set WIZARD_API_TOKEN in any deployed environment (#132)."
        )
    # Reap idle live wizard-agent clients so subprocesses don't accumulate.
    reaper = asyncio.create_task(agent_service.cleanup_idle_sessions())
    try:
        yield
    finally:
        reaper.cancel()


app = FastAPI(title="GAIK Wizard API", version="0.1.0", lifespan=lifespan)

app.add_middleware(ServiceTokenMiddleware)

app.include_router(sessions_router)

if os.getenv("WIZARD_TEST_HOOKS") == "1":
    from wizard_api.routers.test_hooks import router as test_hooks_router

    app.include_router(test_hooks_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
