import { NextRequest } from "next/server";
import { BPMN_VISUAL_STEP, hasBpmnSpike } from "@/lib/bpmn-spike";
import { syncSessionBpmn } from "@/lib/bpmn-generate";
import { requireOwnedSession } from "@/lib/session-access";
import { saveBlueprintAfterBpmnSync } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owned = await requireOwnedSession(id);
  if (!owned) {
    return new Response("Session not found", { status: 404 });
  }
  if (!hasBpmnSpike(id) || owned.session.step < BPMN_VISUAL_STEP) {
    return new Response("BPMN not available for this session", { status: 404 });
  }

  let body: { xml?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!body.xml?.trim()) {
    return new Response("Missing xml", { status: 400 });
  }

  try {
    const result = await syncSessionBpmn(id, owned.session.blueprint, body.xml);
    await saveBlueprintAfterBpmnSync(id, result.blueprint);
    return Response.json({
      blueprint: result.blueprint,
      xml: result.xml,
    });
  } catch (err) {
    console.error("[bpmn sync]", err);
    return new Response("BPMN sync failed", { status: 500 });
  }
}
