import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from wizard_api import config, errors, telemetry
from wizard_api.routers.blueprint_edit import router as blueprint_edit_router
from wizard_api.routers.cases import router as cases_router
from wizard_api.routers.owners import router as owners_router
from wizard_api.routers.sessions import router as sessions_router
from wizard_api.security import ServiceTokenMiddleware
from wizard_api.services import agent_service
from wizard_api.services.blueprint_service import InvalidBlueprintContentError
from wizard_api.services.case_service import CaseNotFoundError

logger = logging.getLogger(__name__)

# Uvicorn has configured its own logging by the time it imports the app; the
# API's loggers get their level and a handler here (WIZARD_LOG_LEVEL).
telemetry.configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not config.service_auth_enabled():
        logger.warning(
            "WIZARD_API_TOKEN is not set - service authentication is DISABLED. "
            "Any caller able to reach this API can read and modify any user's "
            "sessions. Set WIZARD_API_TOKEN in any deployed environment (#132)."
        )
    telemetry.setup()
    # Reap idle live wizard-agent clients so subprocesses don't accumulate.
    reaper = asyncio.create_task(agent_service.cleanup_idle_sessions())
    try:
        yield
    finally:
        reaper.cancel()
        telemetry.shutdown()


APP_VERSION = os.getenv("APP_VERSION", "dev")

# FastAPI can add exporters of its own from the environment
# (FASTAPI_OTEL_AUTO_CONFIGURE). Those would send spans past the recording
# guard, so the only exporters are the ones telemetry.setup installs.
app = FastAPI(
    title="GAIK Wizard API",
    version=APP_VERSION,
    lifespan=lifespan,
    telemetry={"auto_configure": False},
)

# The request's own span for the code that names its session and blueprint
# version (telemetry.RequestSpanMiddleware).
app.add_middleware(telemetry.RequestSpanMiddleware)
app.add_middleware(ServiceTokenMiddleware)
# Outside the token check: a refused token gets a trace id too.
app.add_middleware(errors.TraceIdMiddleware)
# Outermost of all: no request span leaves with a session's id in its path.
app.add_middleware(telemetry.SessionPathMiddleware)
errors.install(app)


@app.exception_handler(InvalidBlueprintContentError)
async def invalid_blueprint_content(_: Request, exc: InvalidBlueprintContentError) -> JSONResponse:
    # Raised wherever a blueprint version is written (PATCH /blueprint,
    # POST /versions, BPMN sync), before anything is committed: the caller
    # gets the same 422 shape FastAPI uses for a bad request body, and the
    # session keeps its previous, servable blueprint.
    # The message names only the fields at fault, and ``errors`` carries
    # pydantic's own loc/msg/type without the input.
    return JSONResponse(
        status_code=422,
        content={"detail": errors.error_detail("invalid_blueprint", str(exc), errors=exc.errors)},
    )


@app.exception_handler(CaseNotFoundError)
async def case_not_found(request: Request, _: CaseNotFoundError) -> JSONResponse:
    # A case removed while another request for it was on its way
    # (case_service.delete_case): not found, as for a case that never was.
    return await errors.http_exception_handler(
        request, HTTPException(status_code=404, detail="case not found")
    )


app.include_router(sessions_router)
app.include_router(blueprint_edit_router)
app.include_router(cases_router)
app.include_router(owners_router)

if os.getenv("WIZARD_TEST_HOOKS") == "1":
    from wizard_api.routers.test_hooks import router as test_hooks_router

    app.include_router(test_hooks_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": APP_VERSION}
