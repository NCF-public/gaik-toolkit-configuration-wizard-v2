// Lists the files the PoC scaffolder produced, so the workspace can show what
// the agent generated. Proxies to wizard_api; returns an empty (not-generated)
// result in mock mode or on upstream failure so the UI never hard-errors.

import { NextRequest } from "next/server";
import { requireOwnedSession } from "@/lib/session-access";
import { withLogging } from "@/lib/with-logging";
import { logger } from "@/lib/logger";
import { getTraceId, setContextUserId } from "@/lib/request-context";
import { wizardApiEnabled, apiGetPocFiles } from "@/lib/wizard-api-client";

export const dynamic = "force-dynamic";

export const GET = withLogging(
  "poc.files",
  async (
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    const owned = await requireOwnedSession(id);
    if (!owned) {
      return new Response("Session not found", { status: 404 });
    }
    setContextUserId(owned.user.email);

    if (!wizardApiEnabled()) {
      return Response.json({ generated: false, files: [] });
    }
    try {
      return Response.json(await apiGetPocFiles(id));
    } catch (err) {
      logger.error(
        { traceId: getTraceId(), err, sessionId: id },
        "poc.files failed",
      );
      return Response.json({ generated: false, files: [] });
    }
  },
);
