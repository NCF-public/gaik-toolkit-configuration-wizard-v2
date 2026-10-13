// PoC generation, streamed back as SSE so the workspace can show progress.
//
// With wizard_api configured this scaffolds the real package from the session's
// approved blueprint (#93) and reports the files it wrote; the listing and zip
// endpoints next to this one then serve it. Without wizard_api (mock dev and
// the mock e2e suite) it keeps the original simulated run.

import { NextRequest } from "next/server";
import { getI18n } from "@/lib/i18n";
import { requireOwnedSession } from "@/lib/session-access";
import { withLogging } from "@/lib/with-logging";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getTraceId, setContextUserId } from "@/lib/request-context";
import { apiGeneratePoc, wizardApiEnabled } from "@/lib/wizard-api-client";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

/**
 * Stream the log lines, then one terminal frame. `paced` spaces the lines out
 * for the simulated run; the real scaffolder has already finished by the time
 * we know what it wrote, so there is nothing to pace.
 */
function sse(lines: string[], { paced, status }: { paced: boolean; status: string }): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ log: line })}\n\n`));
        if (paced) await sleep(120);
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, status })}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

export const POST = withLogging(
  "poc.generate",
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const owned = await requireOwnedSession(id);
    if (!owned) {
      return new Response("Session not found", { status: 404 });
    }
    setContextUserId(owned.user.email);
    const session = owned.session;
    const { t } = await getI18n();

    if (!wizardApiEnabled()) {
      // Mock dev: there is no backend to scaffold with, so walk the blueprint.
      audit("poc.generate", {
        actor: owned.user.email,
        resource: { type: "session", id },
        outcome: "success",
        mode: "mock",
        stepCount: session.blueprint.steps.length,
      });
      const lines: string[] = [t.pocLogStart, t.pocLogDeps];
      for (const step of session.blueprint.steps) {
        lines.push(`${t.pocLogStep} ${step.name}`);
        lines.push(`  ✓ ${step.name} — ${t.pocLogStepOk}`);
      }
      lines.push(t.pocLogValidate, t.pocLogDone);
      return sse(lines, { paced: true, status: "success" });
    }

    try {
      const upstream = await apiGeneratePoc(id);
      if (!upstream.ok) {
        // A rejected call is not "nothing to generate" — say so in the log and
        // in the audit trail rather than reporting a PoC that never happened.
        logger.error(
          { traceId: getTraceId(), sessionId: id, status: upstream.status },
          "poc.generate upstream rejected the request",
        );
        audit("poc.generate", {
          actor: owned.user.email,
          resource: { type: "session", id },
          outcome: "error",
          status: upstream.status,
        });
        return sse([t.pocLogFailed], { paced: false, status: "failed" });
      }

      const result = (await upstream.json()) as {
        pattern?: string;
        files?: string[];
        regenerated?: boolean;
        scaffolded?: boolean;
        source?: string;
      };
      const files = result.files ?? [];
      audit("poc.generate", {
        actor: owned.user.email,
        resource: { type: "session", id },
        outcome: "success",
        mode: result.source ?? "scaffolder",
        pattern: result.pattern ?? "",
        fileCount: files.length,
        regenerated: Boolean(result.regenerated),
        scaffolded: result.scaffolded !== false,
      });
      // The agent's own package is kept, not rewritten — say that rather than
      // reporting files this route did not write.
      const lines =
        result.scaffolded === false
          ? [t.pocLogAgentPackage, t.pocLogDone]
          : [
              t.pocLogGenerating,
              ...files.map((file) => `  ✓ ${t.pocLogWrote} poc/${file}`),
              t.pocLogDone,
            ];
      return sse(lines, { paced: false, status: "success" });
    } catch (err) {
      logger.error({ traceId: getTraceId(), err, sessionId: id }, "poc.generate failed");
      audit("poc.generate", {
        actor: owned.user.email,
        resource: { type: "session", id },
        outcome: "error",
      });
      return sse([t.pocLogFailed], { paced: false, status: "failed" });
    }
  },
);
