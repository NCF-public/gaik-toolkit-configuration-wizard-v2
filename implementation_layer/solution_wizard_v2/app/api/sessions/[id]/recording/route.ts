// The user's answer to whether a session's usage data may be stored for
// monitoring.
//
// A session starts without the answer: its chat asks before the wizard's
// first reply, and the answer is given here, once. Until it is "stored",
// wizard_api sends none of the session's traces anywhere.
//
// 200: taken. 409: the session already has the other answer. 400: not one of
// the two answers.

import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireOwnedSession } from "@/lib/session-access";
import { answerSessionRecording } from "@/lib/sessions";
import { withLogging } from "@/lib/with-logging";
import { setContextUserId, getTraceId } from "@/lib/request-context";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export const POST = withLogging("session.recording", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const owned = await requireOwnedSession(id);
  if (!owned) {
    return new Response("Session not found", { status: 404 });
  }
  setContextUserId(owned.user.email);

  const body = (await req.json().catch(() => null)) as { answer?: unknown } | null;
  const answer = body?.answer;
  if (answer !== "stored" && answer !== "not_stored") {
    return Response.json({ error: "invalid_answer" }, { status: 400 });
  }

  const result = await answerSessionRecording(id, answer);
  if (result === "ok") {
    // The session's page reads the answer with the session.
    revalidatePath(`/sessions/${id}`);
    return Response.json({ recording: answer });
  }
  if (result === "answered") return Response.json({ error: "already_answered" }, { status: 409 });
  logger.error({ traceId: getTraceId(), sessionId: id }, "session.recording upstream failed");
  return Response.json({ error: "upstream" }, { status: 502 });
});
