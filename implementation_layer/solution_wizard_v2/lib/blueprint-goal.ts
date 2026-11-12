/**
 * The goal wizard_api writes into the blueprint it creates with a new session,
 * before the wizard has learned what the solution is for
 * (wizard_api/services/blueprint_service.py). It says something about the
 * draft, not about the user's goal, so it is not shown as one.
 */
export const DRAFT_GOAL_PLACEHOLDER = "Draft flow so BPMN and JSON are editable from the first session.";

const sameText = (text: string) => text.replace(/\s+/g, " ").trim().replace(/\.$/, "").toLowerCase();

/** The blueprint's goal as the user reads it: empty while it is still the draft's placeholder. */
export function shownGoal(goal: string | null | undefined): string {
  const text = (goal ?? "").trim();
  return sameText(text) === sameText(DRAFT_GOAL_PLACEHOLDER) ? "" : text;
}
