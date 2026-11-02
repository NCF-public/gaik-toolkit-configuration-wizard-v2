"""The only process in the api pod that holds the cluster credential.

The api container runs the wizard agent, which has tools, and the PoC scripts it
generates. A ServiceAccount token mounted there could be read by either and used
to create any Job in the project, including one that mounts the project's
Secrets: RBAC can say "may create Jobs" but not "only this Job". So the token is
mounted in this sidecar alone, and the api asks it for runs over localhost.

What it accepts is a run, not a Job: a session id, a kind, a case and a user. It
renders the Job itself from the reviewed manifest with ``SandboxRunner``, so a
caller cannot change the image, the mounts or the environment of what runs. It
answers only callers that present the service token, which the api keeps out of
the agent's environment (``config``).

Run as ``uvicorn wizard_api.sandbox_gate:app --host 127.0.0.1 --port 8101``.
"""

from __future__ import annotations

import hmac
from collections.abc import Iterator

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from wizard_api.config import get_service_token
from wizard_api.services import sandbox_runner

TOKEN_HEADER = "X-Wizard-Service-Token"


def _require_token(
    presented: str | None = Header(default=None, alias=TOKEN_HEADER),
) -> None:
    """Refuse everything unless the service token is configured and presented.

    Unlike the api, there is no "auth off" mode: without a token the gate would
    hand runs to anything in the pod.
    """
    expected = get_service_token()
    if not expected or not presented or not hmac.compare_digest(presented, expected):
        raise HTTPException(status_code=401, detail="not authorised")


app = FastAPI(title="wizard-api sandbox gate", dependencies=[Depends(_require_token)])


@app.exception_handler(sandbox_runner.RunNotFoundError)
async def _not_found(_: Request, exc: sandbox_runner.RunNotFoundError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=404)


@app.exception_handler(sandbox_runner.SandboxNotConfiguredError)
async def _not_configured(
    _: Request, exc: sandbox_runner.SandboxNotConfiguredError
) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=503)


@app.exception_handler(ValueError)
async def _bad_value(_: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=422)


def _runner() -> sandbox_runner.SandboxRunner:
    # local=True: this is the end of the line, never forward to a gate again.
    return sandbox_runner.SandboxRunner(local=True)


class RunRequest(BaseModel):
    session_id: str
    run_id: str | None = None
    kind: str | None = None
    case_id: str | None = None
    user_id: str | None = None


@app.post("/runs")
def create_run(body: RunRequest) -> dict:
    run_id = _runner().create_run(
        body.session_id,
        run_id=body.run_id,
        kind=body.kind,
        case_id=body.case_id,
        user_id=body.user_id,
    )
    return {"run_id": run_id}


@app.get("/runs/{run_id}")
def status(run_id: str, session_id: str | None = None) -> dict:
    s = _runner().status(run_id, session_id=session_id)
    return {"run_id": s.run_id, "phase": s.phase, "exit_code": s.exit_code, "message": s.message}


@app.get("/runs/{run_id}/kind")
def run_kind(run_id: str) -> dict:
    return {"kind": _runner().run_kind(run_id)}


@app.get("/runs/{run_id}/log")
def read_log(run_id: str) -> dict:
    return {"log": _runner().read_log(run_id)}


@app.get("/runs/{run_id}/stream")
def stream_logs(run_id: str) -> StreamingResponse:
    runner = _runner()
    lines = runner.stream_logs(run_id)
    # Pull the first line here, so a run that never started answers with its
    # error status instead of a 200 whose body breaks off.
    first = next(lines, None)

    def body() -> Iterator[bytes]:
        if first is None:
            return
        yield (first + "\n").encode("utf-8")
        for line in lines:
            yield (line + "\n").encode("utf-8")

    return StreamingResponse(body(), media_type="text/plain; charset=utf-8")


@app.delete("/runs/{run_id}")
def delete_run(run_id: str) -> dict:
    _runner().delete_run(run_id)
    return {"deleted": run_id}
