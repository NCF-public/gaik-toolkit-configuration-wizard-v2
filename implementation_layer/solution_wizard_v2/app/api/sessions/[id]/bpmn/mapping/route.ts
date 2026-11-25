// Which blueprint element each element of the diagram stands for
// (`{mapping: {element_id: {kind, blueprint_path}}}`), for the drawing mode
// `data_objects` names, as for /bpmn. Owner and step check as for /bpmn,
// refusals through lib/safe-error; without wizard_api: 503 needs_wizard_api.

import { NextRequest } from "next/server";
import { BPMN_VISUAL_STEP, hasBpmnSpike } from "@/lib/bpmn-spike";
import { requireOwnedSession } from "@/lib/session-access";
import { withLogging } from "@/lib/with-logging";
import { setContextUserId } from "@/lib/request-context";
import { parseDataObjectsParam } from "@/lib/bpmn-show-data";
import { needsWizardApi, passJson, relayUpstream } from "@/lib/blueprint-proxy";
import { apiGetBpmnMapping, wizardApiEnabled } from "@/lib/wizard-api-client";

export const dynamic = "force-dynamic";

export const GET = withLogging(
  "bpmn.mapping",
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const owned = await requireOwnedSession(id);
    if (!owned) return new Response("Session not found", { status: 404 });
    setContextUserId(owned.user.email);
    // As for /bpmn: no diagram before its step.
    if (!hasBpmnSpike(id) || owned.session.step < BPMN_VISUAL_STEP) {
      return new Response("BPMN not available for this session", { status: 404 });
    }
    if (!wizardApiEnabled()) return needsWizardApi();

    const dataObjects = parseDataObjectsParam(req.nextUrl.searchParams.get("data_objects"));
    if (dataObjects === null) return new Response("data_objects must be 0 or 1", { status: 400 });

    return relayUpstream(() => apiGetBpmnMapping(id, { dataObjects }), passJson, {
      event: "bpmn.mapping",
      sessionId: id,
    });
  },
);
