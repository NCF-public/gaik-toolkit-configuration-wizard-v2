"""Marks what the wizard hands out as AI-generated, in a form a machine can read.

A package carries ``AI-GENERATED.json`` and a download carries two headers. The
marker is written when the package is handed out, over any file of that name the
package holds, so what it says comes from this service and not from the session.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from typing import Any

from wizard_api.services import agent_service

MARKER_FILE = "AI-GENERATED.json"
GENERATOR = "GAIK Solution Wizard"
SCHEMA = "gaik.ai-generated/1"
#: The IPTC term for content made by a trained model.
DIGITAL_SOURCE_TYPE = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"


def model() -> str:
    """The model this deployment's agent uses."""
    return agent_service.agent_model()


def marker(session: Any, content: str, now: datetime | None = None) -> dict[str, Any]:
    return {
        "schema": SCHEMA,
        "ai_generated": True,
        "digital_source_type": DIGITAL_SOURCE_TYPE,
        "generator": GENERATOR,
        "generator_version": os.getenv("APP_VERSION", "dev"),
        "model": model(),
        "content": content,
        "session_id": str(session.id),
        "blueprint_version": session.active_version,
        "exported_at": (now or datetime.now(UTC)).isoformat(timespec="seconds"),
    }


def marker_json(session: Any, content: str) -> str:
    return json.dumps(marker(session, content), indent=2) + "\n"


def headers() -> dict[str, str]:
    return {"X-AI-Generated": "true", "X-AI-Model": model()}
