import { BPMN_VISUAL_STEP, POC_STEP } from "@/lib/mock-sessions";

export type WorkspaceTab = "flow" | "json" | "plan" | "poc";

/**
 * Which workspace tab should the panel switch to, if any, when the session's
 * step moves forward — chat progresses the session on its own (router.refresh()
 * after each turn), so a milestone can be reached without the user ever
 * touching this panel (#138, raised by a customer reviewer on 28 Aug: "the
 * chat and this user interface are not in sync"). A finished PoC went
 * completely unseen because the tab sat wherever it was last clicked.
 *
 * Returns null when nothing should change: the step didn't move forward, or
 * it moved forward but didn't cross a milestone. Never suggests moving
 * backward — regressing a step (e.g. Gate rejection) shouldn't yank the tab
 * out from under whatever the user is looking at.
 */
export function nextTabForStepChange(prevStep: number, newStep: number): WorkspaceTab | null {
  if (newStep <= prevStep) return null;
  if (newStep >= POC_STEP && prevStep < POC_STEP) return "poc";
  if (newStep >= BPMN_VISUAL_STEP && prevStep < BPMN_VISUAL_STEP) return "flow";
  return null;
}
