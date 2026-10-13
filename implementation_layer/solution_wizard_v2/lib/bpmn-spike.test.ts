import { describe, expect, it } from "vitest";
import {
  BPMN_SPIKE_SESSION_IDS,
  BPMN_V2_STARTED,
  BPMN_VISUAL_STEP,
  hasBpmnSpike,
  shouldShowBpmnSpike,
} from "@/lib/bpmn-spike";

describe("bpmn-spike", () => {
  it("marks V2 BPMN as started", () => {
    expect(BPMN_V2_STARTED).toBe(true);
  });

  it("enables mock seed session ids", () => {
    expect(hasBpmnSpike("ses_chatbot")).toBe(true);
    expect(BPMN_SPIKE_SESSION_IDS.has("ses_laskut")).toBe(true);
  });

  it("enables UUID sessions from wizard_api", () => {
    expect(hasBpmnSpike("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("rejects unknown short ids", () => {
    expect(hasBpmnSpike("ses_unknown")).toBe(false);
  });

  it("requires phase 8+ for BPMN display", () => {
    expect(shouldShowBpmnSpike("ses_chatbot", BPMN_VISUAL_STEP - 1)).toBe(false);
    expect(shouldShowBpmnSpike("ses_chatbot", BPMN_VISUAL_STEP)).toBe(true);
    expect(
      shouldShowBpmnSpike(
        "550e8400-e29b-41d4-a716-446655440000",
        BPMN_VISUAL_STEP,
      ),
    ).toBe(true);
  });
});
