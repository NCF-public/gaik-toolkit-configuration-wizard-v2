import { describe, expect, it } from "vitest";
import { createSession, defaultBlueprint, resetMockSessions } from "@/lib/mock-sessions";
import { hasBpmnSpike, shouldShowBpmnSpike, BPMN_VISUAL_STEP } from "@/lib/bpmn-spike";

describe("createSession dummy blueprint (MIC012)", () => {
  it("seeds a placeholder blueprint with several editable steps", () => {
    const bp = defaultBlueprint("Safety report");
    expect(bp.steps.length).toBeGreaterThanOrEqual(3);
    expect(bp.description.toLowerCase()).toContain("placeholder");
    expect(bp.steps.map((s) => s.id)).toEqual([
      "input",
      "process",
      "review",
      "output",
    ]);
  });

  it("new mock sessions get BPMN-capable ids and dummy content", () => {
    resetMockSessions();
    const s = createSession("dev@gaik.local", "MIC012 dummy demo");
    expect(hasBpmnSpike(s.id)).toBe(true);
    expect(s.blueprint.steps.length).toBeGreaterThanOrEqual(3);
    expect(s.step).toBe(1);
    expect(shouldShowBpmnSpike(s.id, s.step)).toBe(false);
    expect(shouldShowBpmnSpike(s.id, BPMN_VISUAL_STEP)).toBe(true);
  });
});
