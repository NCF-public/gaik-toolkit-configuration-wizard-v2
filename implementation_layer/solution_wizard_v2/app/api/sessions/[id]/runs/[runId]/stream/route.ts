// Follow one sandbox run's output (#94 -> #92).
//
// The SSE frames are wizard_api's and are piped through untouched, so the UI
// reads the same contract the chat stream uses:
//   data: {"log": "..."} · {"heartbeat": true} · {"done": true, "phase": "..."}

import { NextRequest } from "next/server";
import { requireOwnedSession } from "@/lib/session-access";
import { withLogging } from "@/lib/with-logging";
import { setContextUserId } from "@/lib/request-context";
import { apiStreamPocRun } from "@/lib/wizard-api-client";

export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export const GET = withLogging(
  "poc.run.stream",
  async (
    _req: NextRequest,
    { params }: { params: Promise<{ id: string; runId: string }> },
  ) => {
    const { id, runId } = await params;
    const owned = await requireOwnedSession(id);
    if (!owned) return new Response("Session not found", { status: 404 });
    setContextUserId(owned.user.email);

    const upstream = await apiStreamPocRun(id, runId);
    if (!upstream.ok || !upstream.body) {
      return new Response(await upstream.text(), { status: upstream.status });
    }
    return new Response(upstream.body, { headers: SSE_HEADERS });
  },
);
