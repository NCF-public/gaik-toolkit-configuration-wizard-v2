// Where the user placed the diagram's shapes and edges, kept apart from the
// blueprint (`{shapes, edges}`, null for an id resets it). `data_objects`
// names the drawing mode the layout is of, as for /bpmn. Owner and step check
// as for /bpmn, an audit line, a 64 KB bound, 422 invalid_layout passed on
// through lib/safe-error; without wizard_api: 503 needs_wizard_api. DELETE resets
// the layout of both drawing modes, with the same checks and its own audit line.

import { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { BPMN_VISUAL_STEP, hasBpmnSpike } from "@/lib/bpmn-spike";
import { requireOwnedSession } from "@/lib/session-access";
import { withLogging } from "@/lib/with-logging";
import { setContextUserId } from "@/lib/request-context";
import { MAX_EDIT_BODY_BYTES } from "@/lib/blueprint-ops";
import { parseDataObjectsParam } from "@/lib/bpmn-show-data";
import { needsWizardApi, readLimitedJson, relayUpstream } from "@/lib/blueprint-proxy";
import { apiDeleteBpmnLayout, apiPutBpmnLayout, wizardApiEnabled } from "@/lib/wizard-api-client";

export const dynamic = "force-dynamic";

export const PUT = withLogging(
  "bpmn.layout.save",
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

    const read = await readLimitedJson(req, MAX_EDIT_BODY_BYTES);
    if ("refused" in read) return read.refused;

    return relayUpstream(
      () => apiPutBpmnLayout(id, read.body, { dataObjects }),
      () => new Response(null, { status: 204 }),
      {
        event: "bpmn.layout.save",
        sessionId: id,
        // The drawing mode, not the positions.
        onDone: (outcome) =>
          audit("bpmn.layout", {
            actor: owned.user.email,
            resource: { type: "session", id },
            outcome,
            dataObjects,
          }),
      },
    );
  },
);

export const DELETE = withLogging(
  "bpmn.layout.reset",
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const owned = await requireOwnedSession(id);
    if (!owned) return new Response("Session not found", { status: 404 });
    setContextUserId(owned.user.email);
    if (!hasBpmnSpike(id) || owned.session.step < BPMN_VISUAL_STEP) {
      return new Response("BPMN not available for this session", { status: 404 });
    }
    if (!wizardApiEnabled()) return needsWizardApi();

    return relayUpstream(
      () => apiDeleteBpmnLayout(id),
      () => new Response(null, { status: 204 }),
      {
        event: "bpmn.layout.reset",
        sessionId: id,
        onDone: (outcome) =>
          audit("bpmn.layout.reset", { actor: owned.user.email, resource: { type: "session", id }, outcome }),
      },
    );
  },
);
