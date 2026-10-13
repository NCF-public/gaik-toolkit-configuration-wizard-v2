// SSE streaming endpoint for the mock PoC run logs.
// Streams logs as text/event-stream, line by line. Mock: iterates the blueprint
// steps; replace with a real isolated run.

import { NextRequest } from "next/server";
import { getI18n } from "@/lib/i18n";
import { requireOwnedSession } from "@/lib/session-access";
import { withLogging } from "@/lib/with-logging";
import { audit } from "@/lib/audit";
import { setContextUserId } from "@/lib/request-context";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const POST = withLogging(
  "poc.generate",
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
    const session = owned.session;

    audit("poc.generate", {
      actor: owned.user.email,
      resource: { type: "session", id },
      outcome: "success",
      stepCount: session.blueprint.steps.length,
    });

    const { t } = await getI18n();

    const lines: string[] = [t.pocLogStart, t.pocLogDeps];
    for (const step of session.blueprint.steps) {
      lines.push(`${t.pocLogStep} ${step.name}`);
      lines.push(`  ✓ ${step.name} — ${t.pocLogStepOk}`);
    }
    lines.push(t.pocLogValidate);
    lines.push(t.pocLogDone);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (const line of lines) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ log: line })}\n\n`),
          );
          await sleep(120);
        }
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ done: true, status: "success" })}\n\n`,
          ),
        );
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  },
);
