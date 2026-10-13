import { NextRequest } from "next/server";
import { BPMN_VISUAL_STEP, hasBpmnSpike } from "@/lib/bpmn-spike";
import { fetchBpmnXmlForSession } from "@/lib/bpmn-generate";
import { requireOwnedSession } from "@/lib/session-access";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
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

  try {
    const xml = await fetchBpmnXmlForSession(id, owned.session.blueprint);
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[bpmn GET]", err);
    return new Response("BPMN generation failed", { status: 500 });
  }
}
