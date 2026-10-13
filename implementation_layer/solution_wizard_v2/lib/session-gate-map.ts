import type { GateStatus } from "@/lib/mock-sessions";
import { GATE_STEPS } from "@/lib/mock-sessions";

/** UI gate step → wizard_api gate_statuses key. */
export const GATE_STEP_TO_API: Record<number, string> = {
  4: "gate_1",
  9: "gate_2",
  11: "gate_3",
  13: "gate_4",
};

export function apiGateKeyForStep(gateStep: number): string | undefined {
  return GATE_STEP_TO_API[gateStep];
}

/** Map API gate_statuses to UI step-keyed gate map (includes locked). */
export function apiGatesToUi(
  step: number,
  gateStatuses: Record<string, string>,
): Record<number, GateStatus> {
  const result: Record<number, GateStatus> = {};
  for (const gateStep of GATE_STEPS) {
    const key = GATE_STEP_TO_API[gateStep];
    if (step > gateStep) {
      result[gateStep] = "approved";
    } else if (step < gateStep) {
      result[gateStep] = "locked";
    } else {
      const raw = gateStatuses[key];
      result[gateStep] =
        raw === "approved" || raw === "rejected" ? raw : "pending";
    }
  }
  return result;
}

/** Patch body for approving the gate at the current step. */
export function uiGateApprovalPatch(
  gateStep: number,
): Record<string, string> | undefined {
  const key = GATE_STEP_TO_API[gateStep];
  return key ? { [key]: "approved" } : undefined;
}
