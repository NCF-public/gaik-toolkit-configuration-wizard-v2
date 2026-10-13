// Start a sandbox run of the session's PoC package (#94 -> #91).
//
// A thin proxy: wizard_api owns the gate check, the package completeness check
// and the Job. Deliberately no mock path — a run that did not happen must not
// be able to report that it did, which is the misunderstanding the previous
// simulated "Run PoC" created with the customer.

import { NextRequest } from "next/server";
import { requireOwnedSession } from "@/lib/session-access";
import { withLogging } from "@/lib/with-logging";
import { setContextUserId } from "@/lib/request-context";
import { apiCreatePocRun, wizardAgentChatEnabled } from "@/lib/wizard-api-client";

export const dynamic = "force-dynamic";

export const POST = withLogging(
  "poc.run.create",
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

    const upstream = await apiCreatePocRun(id);
    // Pass the upstream status through: 409 (gate, incomplete package) and 503
    // (deployment missing a piece) both say something the user needs to read.
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  },
);
