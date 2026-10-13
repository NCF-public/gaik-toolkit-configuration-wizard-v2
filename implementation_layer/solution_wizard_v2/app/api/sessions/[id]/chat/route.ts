// SSE streaming endpoint for the mock chat reply.
// Streams the reply as text/event-stream, token by token. Mock: the reply is
// phase-aware and in the user's language (i18n cookie).

import { NextRequest } from "next/server";
import { getI18n } from "@/lib/i18n";
import { requireOwnedSession } from "@/lib/session-access";
import { postMessage } from "@/lib/sessions";
import { resolveChatReply, toStreamTokens } from "@/lib/chat-driver";
import {
  openAgentChatStream,
  wizardAgentChatEnabled,
} from "@/lib/wizard-api-client";
import { withLogging } from "@/lib/with-logging";
import { setContextUserId, getTraceId } from "@/lib/request-context";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sse(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export const POST = withLogging("chat.post", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const userMessage = ((body?.message as string) ?? "").trim();

  if (!userMessage) {
    return new Response("Empty message", { status: 400 });
  }

  const owned = await requireOwnedSession(id);
  if (!owned) {
    return new Response("Session not found", { status: 404 });
  }
  setContextUserId(owned.user.email);

  // Read the locale before the agent call, not after it: it is what pins the
  // agent's reply language. The whole chain already existed — the client sends
  // it, wizard_api accepts it, the bootstrap prompt uses it — and this call was
  // the one place that never passed it, so the agent chose its own language.
  const { locale, t } = await getI18n();

  // When the wizard_api agent chat endpoint (#29 backend) is live, proxy the
  // message to it and stream the reply straight through. wizard_api persists the
  // exchange. A failure is a failure: it used to fall through to the mock reply
  // below, which was then stored in the transcript as the wizard's answer. The
  // mock is for local dev without wizard_api only.
  if (wizardAgentChatEnabled()) {
    const json = { "Content-Type": "application/json" };
    try {
      const upstream = await openAgentChatStream(id, userMessage, locale);
      if (upstream.ok && upstream.body) {
        return new Response(upstream.body, { headers: SSE_HEADERS });
      }
      if (upstream.status === 409) {
        // The agent is still answering the previous message (#173 wake-up).
        return new Response(JSON.stringify({ error: "busy" }), { status: 409, headers: json });
      }
      logger.error(
        { traceId: getTraceId(), sessionId: id, status: upstream.status },
        "chat.post agent upstream returned non-ok",
      );
      return new Response(JSON.stringify({ error: "upstream", status: upstream.status }), {
        status: 502,
        headers: json,
      });
    } catch (err) {
      logger.error({ traceId: getTraceId(), err, sessionId: id }, "chat.post agent upstream threw");
      return new Response(JSON.stringify({ error: "upstream" }), { status: 502, headers: json });
    }
  }

  // Local dev without wizard_api: a scripted reply so the UI can be exercised.
  const fullReply = await resolveChatReply(id, owned.session, userMessage, t);
  const tokens = toStreamTokens(fullReply);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (const token of tokens) {
          if (req.signal.aborted) {
            controller.close();
            return;
          }
          controller.enqueue(sse({ delta: token }));
          await sleep(45);
        }
        // Persist the conversation so a reload shows the complete message.
        await postMessage(id, userMessage, fullReply);
        controller.enqueue(sse({ done: true }));
        controller.close();
      } catch (err) {
        logger.error(
          { traceId: getTraceId(), err, sessionId: id },
          "chat.post reply stream failed",
        );
        controller.enqueue(sse({ error: true }));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
});
