import { NextRequest } from "next/server";
import { BPMN_VISUAL_STEP, hasBpmnSpike } from "@/lib/bpmn-spike";
import { syncSessionBpmn } from "@/lib/bpmn-generate";
import { lintBpmnXml } from "@/lib/bpmn-lint";
import { requireOwnedSession } from "@/lib/session-access";
import { saveBlueprintAfterBpmnSync } from "@/lib/sessions";
import { withLogging } from "@/lib/with-logging";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getTraceId, setContextUserId } from "@/lib/request-context";

export const dynamic = "force-dynamic";

export const POST = withLogging(
  "bpmn.sync",
  async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    const owned = await requireOwnedSession(id);
    if (!owned) {
      return new Response("Session not found", { status: 404 });
    }
    setContextUserId(owned.user.email);
    if (!hasBpmnSpike(id) || owned.session.step < BPMN_VISUAL_STEP) {
      return new Response("BPMN not available for this session", { status: 404 });
    }

    let body: { xml?: string; force?: boolean };
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!body.xml?.trim()) {
      return new Response("Missing xml", { status: 400 });
    }

    let lint;
    try {
      lint = await lintBpmnXml(body.xml);
    } catch (err) {
      logger.error({ traceId: getTraceId(), err, sessionId: id }, "bpmn.sync lint failed");
      return new Response("BPMN lint failed", { status: 500 });
    }

    // Blocking errors prevent silent persist (#47). Callers may pass force=true
    // only for emergency recovery — not exposed in the normal UI.
    if (!lint.ok && !body.force) {
      audit("bpmn.sync", {
        actor: owned.user.email,
        resource: { type: "session", id },
        outcome: "denied",
        reason: "lint_failed",
      });
      return Response.json(
        {
          error: "bpmn_lint_failed",
          message: "BPMN validation failed",
          lint,
        },
        { status: 422 },
      );
    }

    try {
      const result = await syncSessionBpmn(id, owned.session.blueprint, body.xml);
      await saveBlueprintAfterBpmnSync(id, result.blueprint);
      audit("bpmn.sync", {
        actor: owned.user.email,
        resource: { type: "session", id },
        outcome: "success",
      });
      return Response.json({
        blueprint: result.blueprint,
        xml: result.xml,
        lint,
      });
    } catch (err) {
      logger.error({ traceId: getTraceId(), err, sessionId: id }, "bpmn.sync failed");
      audit("bpmn.sync", {
        actor: owned.user.email,
        resource: { type: "session", id },
        outcome: "error",
      });
      return new Response("BPMN sync failed", { status: 500 });
    }
  },
);
