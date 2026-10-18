"""What the agent is told about the latest PoC run, so it can refine the package (#96).

Gate 3 is a loop: run the PoC in the sandbox, say what is wrong, let the agent
fix it, run again. The agent could not see the run: the result lived in the
sandbox pod and its log, and the user had to describe it from memory. The
customer's test found exactly that — the wizard "cannot see the sandbox output
or the generated PDF, so it fails to validate the PoC" (October 2026).

So on the first message after a run has finished, the run's log and output files
are copied into ``runs/<run id>/`` in the session's output directory, where the
agent reads its other files, and one line in front of the message says the run
happened, how it ended, and where to look.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

from wizard_api.services import case_service

RUNS_DIR = "runs"
LOG_TAIL_BYTES = 64 * 1024

_SAFE_RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def run_dir(output_dir: str, run_id: str) -> str:
    if not _SAFE_RUN_ID.match(run_id):
        raise ValueError(f"not a run id: {run_id!r}")
    return os.path.join(output_dir, RUNS_DIR, run_id)


def running_line(run_id: str) -> str:
    return (
        f"[PoC sandbox run {run_id} is still running; its result will be available "
        "with the user's next message.]"
    )


def collect(output_dir: str, run_id: str, status: Any, log: str) -> str:
    """Copy a finished run's log and output files for the agent; the line that tells it.

    ``status`` is the runner's ``RunStatus``. Text files come from the output
    block, every file (a PDF included) from the download block; the log is kept
    from its end, where a failure says why.
    """
    dest = run_dir(output_dir, run_id)
    out = os.path.join(dest, "output")
    os.makedirs(out, exist_ok=True)

    tail = log.encode("utf-8", "replace")[-LOG_TAIL_BYTES:].decode("utf-8", "replace")
    with open(os.path.join(dest, "log.txt"), "w", encoding="utf-8") as fh:
        fh.write(tail)

    downloads, skipped = case_service.output_downloads(log, run_id)
    for name, data in downloads.items():
        with open(os.path.join(out, name), "wb") as fh:
            fh.write(data)
    for name, body in case_service.output_files(log, run_id).items():
        base = os.path.basename(name)
        if base and base not in downloads:
            with open(os.path.join(out, base), "w", encoding="utf-8") as fh:
                fh.write(body.strip() + "\n")

    phase = getattr(status, "phase", "unknown")
    reason = (
        None
        if phase == "succeeded"
        else case_service.run_failure_message(phase, log, getattr(status, "message", None))
    )
    files = sorted(os.listdir(out))
    with open(os.path.join(dest, "run.json"), "w", encoding="utf-8") as fh:
        json.dump(
            {
                "run_id": run_id,
                "phase": phase,
                "exit_code": getattr(status, "exit_code", None),
                "failure_reason": reason,
                "files": files,
                "skipped": skipped,
            },
            fh,
            indent=2,
        )

    where = f"{RUNS_DIR}/{run_id}/"
    if phase == "succeeded":
        how = "succeeded"
    else:
        how = f"{phase}: {reason}"
    produced = ", ".join(files) if files else "no output files"
    return (
        f"[PoC sandbox run {run_id} {how}. It produced {produced}. Its log (log.txt) "
        f"and output files (output/) are in {where} in the output directory. Read them "
        "and check the result against the target output spec before you answer.]"
    )
