import { describe, expect, it } from "vitest";
import { BPMN_VISUAL_STEP, POC_STEP } from "@/lib/mock-sessions";
import { nextTabForStepChange } from "@/lib/workspace-tab-follow";

// Bug this covers (#138): the customer reviewer completed a whole PoC via chat alone —
// the workspace panel never followed, so nothing was ever visible ("the chat and this
// user interface are not in sync"). These pin the exact milestone crossings that must
// switch tabs, and the cases that must NOT.

describe("nextTabForStepChange", () => {
  it("does nothing when the step doesn't move", () => {
    expect(nextTabForStepChange(5, 5)).toBeNull();
  });

  it("does nothing when the step regresses (e.g. a gate rejection)", () => {
    expect(nextTabForStepChange(BPMN_VISUAL_STEP, BPMN_VISUAL_STEP - 1)).toBeNull();
  });

  it("does nothing for a forward step that doesn't cross a milestone", () => {
    expect(nextTabForStepChange(1, 2)).toBeNull();
  });

  it("switches to flow when crossing into the BPMN-visual step", () => {
    expect(nextTabForStepChange(BPMN_VISUAL_STEP - 1, BPMN_VISUAL_STEP)).toBe("flow");
  });

  it("does not re-trigger flow once already past the BPMN-visual step", () => {
    expect(nextTabForStepChange(BPMN_VISUAL_STEP, BPMN_VISUAL_STEP + 1)).toBeNull();
  });

  it("switches to poc when crossing into the PoC step", () => {
    expect(nextTabForStepChange(POC_STEP - 1, POC_STEP)).toBe("poc");
  });

  it("switches straight to poc when a jump skips past several steps at once", () => {
    // chat-driven progress can move more than one step between refreshes
    expect(nextTabForStepChange(BPMN_VISUAL_STEP, POC_STEP + 1)).toBe("poc");
  });

  it("does not re-trigger poc once already at/past the PoC step", () => {
    expect(nextTabForStepChange(POC_STEP, POC_STEP + 1)).toBeNull();
  });
});
