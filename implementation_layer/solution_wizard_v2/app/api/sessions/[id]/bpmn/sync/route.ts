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

    // The linter runs as a child process. If it cannot start at all — e.g. a
    // dependency missing from the standalone build — that is an infrastructure
    // failure, not a rejected diagram, so it must not block a save: linting is
    // quality assurance, not a persistence gate. Log it and proceed with
    // lint === null (the response reports the diagram was not linted). A lint
    // that RAN and found blocking errors is still enforced below (#47).
    let lint: Awaited<ReturnType<typeof lintBpmnXml>> | null = null;
    try {
      lint = await lintBpmnXml(body.xml);
    } catch (err) {
      logger.warn(
        { traceId: getTraceId(), err, sessionId: id },
        "bpmn.sync lint unavailable, proceeding without it",
      );
    }

    // Blocking errors prevent silent persist (#47). Callers may pass force=true
    // only for emergency recovery — not exposed in the normal UI. A null lint
    // means the linter could not run, which does not gate the save.
    if (lint && !lint.ok && !body.force) {
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
