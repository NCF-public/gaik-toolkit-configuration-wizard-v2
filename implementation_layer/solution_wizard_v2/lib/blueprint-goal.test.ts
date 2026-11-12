import { describe, expect, it } from "vitest";
import { DRAFT_GOAL_PLACEHOLDER, shownGoal } from "./blueprint-goal";

describe("shownGoal", () => {
  it("leaves out the placeholder a new session's blueprint carries", () => {
    expect(shownGoal(DRAFT_GOAL_PLACEHOLDER)).toBe("");
    expect(shownGoal("Draft flow so BPMN and JSON are editable from the first session.")).toBe("");
    expect(shownGoal("  draft flow so BPMN and JSON are editable\nfrom the first session  ")).toBe("");
  });

  it("keeps a goal the wizard or the user wrote", () => {
    expect(shownGoal(" Halve the invoice handling time. ")).toBe("Halve the invoice handling time.");
    expect(shownGoal("Draft flow for the invoice team")).toBe("Draft flow for the invoice team");
  });

  it("is empty when there is no goal", () => {
    expect(shownGoal("")).toBe("");
    expect(shownGoal(null)).toBe("");
    expect(shownGoal(undefined)).toBe("");
  });
});
