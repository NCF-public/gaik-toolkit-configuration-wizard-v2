// Create a synthetic sample input file in poc/sample_input/ for document, text,
// table or JSON slots when the user does not have a real file at hand yet.

import { NextRequest } from "next/server";
import { requireOwnedSession } from "@/lib/session-access";
import { withLogging } from "@/lib/with-logging";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getTraceId, setContextUserId } from "@/lib/request-context";
import { wizardApiEnabled, apiCreatePocSampleInput } from "@/lib/wizard-api-client";
import { isCrossSiteWrite } from "@/lib/same-origin";
import { relayError, unreachableResponse } from "@/lib/safe-error";

export const dynamic = "force-dynamic";

export const POST = withLogging(
  "poc.input.sample",
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    if (isCrossSiteWrite(req)) return new Response("Cross-site request refused", { status: 403 });
    const { id } = await params;
    const owned = await requireOwnedSession(id);
    if (!owned) {
      return new Response("Session not found", { status: 404 });
    }
    setContextUserId(owned.user.email);

    if (!wizardApiEnabled()) {
      return Response.json({ detail: "PoC input is not available" }, { status: 404 });
    }

    let kind: string | undefined;
    try {
      const body = (await req.json()) as { kind?: unknown } | null;
      if (typeof body?.kind === "string" && body.kind.trim()) {
        kind = body.kind.trim().slice(0, 64);
      }
    } catch {
      // Optional body: default to first synthesizable slot.
    }

    try {
      const upstream = await apiCreatePocSampleInput(id, kind);
      if (!upstream.ok) return relayError(upstream);
      const body = (await upstream.json().catch(() => ({}))) as { name?: string; kind?: string };
      audit("poc.input.sample", {
        actor: owned.user.email,
        resource: { type: "session", id },
        outcome: "success",
        action: body.name ?? kind ?? "sample",
      });
      return Response.json(body, { status: upstream.status });
    } catch (err) {
      logger.error({ traceId: getTraceId(), err, sessionId: id }, "poc.input.sample failed");
      return unreachableResponse();
    }
  },
);
