// One file the deployable package carries beside poc/ (the documents, the AI
// Act screening, the AI marker), read only, for the PoC tab's viewer. wizard_api
// decides which names it serves (only those the package carries); this route
// checks the owner and passes a refusal on only as a known code
// (lib/safe-error). Nothing is saved here: a change to these files goes through
// the wizard. The mock store has no files beside poc/.

import { NextRequest } from "next/server";
import { requireOwnedSession } from "@/lib/session-access";
import { withLogging } from "@/lib/with-logging";
import { logger } from "@/lib/logger";
import { getTraceId, setContextUserId } from "@/lib/request-context";
import { currentTraceId, errorResponse, relayError, unreachableResponse } from "@/lib/safe-error";
import { apiGetSolutionFile, wizardApiEnabled } from "@/lib/wizard-api-client";

export const dynamic = "force-dynamic";

const MAX_PATH_CHARS = 512;

function refusal(status: number, error: string, message: string): Response {
  return errorResponse({ error, message, trace_id: currentTraceId() }, status);
}

export const GET = withLogging(
  "solution.file.read",
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const owned = await requireOwnedSession(id);
    if (!owned) return new Response("Session not found", { status: 404 });
    setContextUserId(owned.user.email);

    const path = req.nextUrl.searchParams.get("path");
    if (!path || path.length > MAX_PATH_CHARS) {
      return refusal(422, "invalid_path", "the path is not a file of the package");
    }
    if (!wizardApiEnabled()) return refusal(404, "not_found", "file not found");

    let upstream: Response;
    try {
      upstream = await apiGetSolutionFile(id, path);
    } catch (err) {
      logger.error({ traceId: getTraceId(), err, sessionId: id }, "solution.file.read failed");
      return unreachableResponse();
    }
    if (!upstream.ok) return relayError(upstream);
    return new Response(await upstream.text(), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  },
);
