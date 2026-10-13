/**
 * Session store — wizard_api when WIZARD_API_URL is set, else in-memory mock.
 */

import {
  apiCreateSession,
  apiGetSession,
  apiListSessions,
  apiPatchSession,
  apiPatchBlueprint,
  apiPostMessages,
  apiPostVersion,
  type ApiSessionDetail,
  type ApiSessionSummary,
  wizardApiEnabled,
} from "@/lib/wizard-api-client";
import {
  PHASE_COUNT,
  isGateStep,
  type Blueprint,
  type BlueprintStepType,
  type BlueprintVersion,
  type ChatMessage,
  type WizardSession,
} from "@/lib/mock-sessions";
import * as mock from "@/lib/mock-sessions";

export {
  GATE_STEPS,
  PHASE_COUNT,
  PHASES,
  BPMN_VISUAL_STEP,
  isBpmnVisualPhase,
  isGateStep,
} from "@/lib/mock-sessions";
export type {
  Blueprint,
  BlueprintStep,
  BlueprintStepType,
  BlueprintVersion,
  ChatMessage,
  ChatRole,
  GateStatus,
  WizardSession,
} from "@/lib/mock-sessions";

import {
  apiGatesToUi,
  uiGateApprovalPatch,
  uiGateRejectPatch,
} from "@/lib/session-gate-map";

function detailToWizardSession(detail: ApiSessionDetail): WizardSession {
  return {
    id: detail.id,
    userId: detail.user_id,
    title: detail.title,
    step: detail.step,
    gateStatus: apiGatesToUi(detail.step, detail.gate_statuses),
    status: detail.status === "done" ? "done" : "active",
    outputDir: detail.output_dir,
    createdAt: detail.created_at,
    updatedAt: detail.updated_at,
    versions: detail.versions.map(
      (v): BlueprintVersion => ({
        version: v.version,
        createdAt: v.created_at,
        note: v.note,
      }),
    ),
    activeVersion: detail.active_version,
    messages: detail.messages as ChatMessage[],
    blueprint: {
      ...detail.blueprint,
      steps: detail.blueprint.steps.map((s) => ({
        ...s,
        type: s.type as BlueprintStepType,
      })),
    } satisfies Blueprint,
  };
}

function summaryToWizardSession(summary: ApiSessionSummary): WizardSession {
  const title =
    typeof summary.metadata.title === "string" && summary.metadata.title.trim()
      ? summary.metadata.title.trim()
      : "Nimetön sessio";
  const status =
    summary.metadata.status === "done" || summary.step >= PHASE_COUNT
      ? "done"
      : "active";
  return {
    id: String(summary.id),
    userId: summary.user_id,
    title,
    step: summary.step,
    gateStatus: apiGatesToUi(summary.step, summary.gate_statuses),
    status,
    outputDir: summary.output_dir,
    createdAt: summary.created_at,
    updatedAt: summary.updated_at,
    versions: [],
    activeVersion: summary.active_version,
    messages: [],
    blueprint: {
      name: title,
      description: "",
      goal: "",
      steps: [],
    },
  };
}

export async function listSessions(userId: string): Promise<WizardSession[]> {
  if (!wizardApiEnabled()) {
    return mock.listSessions(userId);
  }
  const summaries = await apiListSessions(userId);
  return summaries.map(summaryToWizardSession);
}

export async function getSession(id: string): Promise<WizardSession | undefined> {
  if (!wizardApiEnabled()) {
    return mock.getSession(id);
  }
  try {
    const detail = await apiGetSession(id);
    return detailToWizardSession(detail);
  } catch {
    return undefined;
  }
}

export async function createSession(
  userId: string,
  title: string,
): Promise<WizardSession> {
  if (!wizardApiEnabled()) {
    return mock.createSession(userId, title);
  }
  const detail = await apiCreateSession(userId, title);
  return detailToWizardSession(detail);
}

export async function postMessage(
  id: string,
  userContent: string,
  assistantContent: string,
): Promise<WizardSession | undefined> {
  if (!wizardApiEnabled()) {
    return mock.postMessage(id, userContent, assistantContent);
  }
  try {
    const detail = await apiPostMessages(id, userContent, assistantContent);
    return detailToWizardSession(detail);
  } catch {
    return undefined;
  }
}

export async function advanceSession(
  id: string,
): Promise<WizardSession | undefined> {
  if (!wizardApiEnabled()) {
    return mock.advanceSession(id);
  }
  const current = await getSession(id);
  if (!current || current.step >= PHASE_COUNT) return current;
  if (isGateStep(current.step) && current.gateStatus[current.step] !== "approved") {
    return current;
  }
  const newStep = current.step + 1;
  await apiPatchSession(id, { step: newStep });
  await apiPostVersion(id, `Vaihe ${newStep}`);
  return getSession(id);
}

export async function regressSession(
  id: string,
): Promise<WizardSession | undefined> {
  if (!wizardApiEnabled()) {
    return mock.regressSession(id);
  }
  const current = await getSession(id);
  if (!current || current.step <= 1) return current;
  await apiPatchSession(id, {
    step: current.step - 1,
    metadata: { status: "active" },
  });
  return getSession(id);
}

export async function approveGate(id: string): Promise<WizardSession | undefined> {
  if (!wizardApiEnabled()) {
    return mock.approveGate(id);
  }
  const current = await getSession(id);
  if (!current || !isGateStep(current.step)) return current;
  const patch = uiGateApprovalPatch(current.step);
  if (!patch) return current;
  if (current.step >= PHASE_COUNT) {
    const detail = await apiPatchSession(id, {
      gate_statuses: patch,
      metadata: { status: "done" },
    });
    return detailToWizardSession(detail);
  }
  await apiPatchSession(id, { gate_statuses: patch });
  return advanceSession(id);
}

export async function rejectGate(id: string): Promise<WizardSession | undefined> {
  if (!wizardApiEnabled()) {
    return mock.rejectGate(id);
  }
  const current = await getSession(id);
  if (!current || !isGateStep(current.step)) return current;
  const patch = uiGateRejectPatch(current.step);
  if (!patch) return current;
  await apiPatchSession(id, {
    gate_statuses: patch,
    metadata: { status: "active" },
  });
  return getSession(id);
}

export async function requestGateChanges(
  id: string,
  feedback: string,
  ack: string,
): Promise<WizardSession | undefined> {
  if (!wizardApiEnabled()) {
    return mock.requestGateChanges(id, feedback, ack);
  }
  // The live agent that revises the specification from the feedback is wired in
  // #29–31. For now, step back to the revision step and record the feedback.
  const current = await getSession(id);
  if (!current || !isGateStep(current.step)) return current;
  await apiPatchSession(id, {
    step: Math.max(1, current.step - 1),
    metadata: { status: "active" },
  });
  await postMessage(id, feedback, ack);
  return getSession(id);
}

export async function saveBlueprintAfterBpmnSync(
  id: string,
  blueprint: Blueprint,
): Promise<WizardSession | undefined> {
  return patchSessionBlueprint(id, blueprint, "BPMN canvas sync");
}

export async function patchSessionBlueprint(
  id: string,
  blueprint: Blueprint,
  note = "Blueprint päivitetty",
): Promise<WizardSession | undefined> {
  if (!wizardApiEnabled()) {
    return mock.updateBlueprint(id, blueprint, note);
  }
  try {
    const detail = await apiPatchBlueprint(id, blueprint, note);
    return detailToWizardSession(detail);
  } catch {
    return undefined;
  }
}
