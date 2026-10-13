// SSE streaming endpoint for the mock chat reply.
// Streams the reply as text/event-stream, token by token. Mock: the reply is
// phase-aware and in the user's language (i18n cookie).

import { NextRequest } from "next/server";
import { getI18n } from "@/lib/i18n";
import { requireOwnedSession } from "@/lib/session-access";
import { postMessage } from "@/lib/sessions";
import { resolveChatReply, toStreamTokens } from "@/lib/chat-driver";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sse(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  // The assistant reply (mock now; real agent #29 drops into resolveChatReply).
  const { t } = await getI18n();
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
      } catch {
        controller.enqueue(sse({ error: true }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
