// Start the preflight of the session's PoC package (#252 -> wizard_api).
//
// A thin proxy, like the run route: wizard_api owns the package check and the
// Job. The preflight calls no model and needs no input; its log is followed on
// the same run stream as a real run. No mock path: a check that did not happen
// must not be able to report that it passed.

import { NextRequest } from "next/server";
import { requireOwnedSession } from "@/lib/session-access";
import { withLogging } from "@/lib/with-logging";
import { setContextUserId } from "@/lib/request-context";
import { apiCreatePocCheck, wizardAgentChatEnabled } from "@/lib/wizard-api-client";

export const dynamic = "force-dynamic";

export const POST = withLogging(
  "poc.check.create",
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const owned = await requireOwnedSession(id);
    if (!owned) return new Response("Session not found", { status: 404 });
    setContextUserId(owned.user.email);

    if (!wizardAgentChatEnabled()) {
      return Response.json(
        { error: "sandbox_unavailable", message: "wizard_api is not configured" },
        { status: 503 },
      );
    }

    const upstream = await apiCreatePocCheck(id);
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  },
);
