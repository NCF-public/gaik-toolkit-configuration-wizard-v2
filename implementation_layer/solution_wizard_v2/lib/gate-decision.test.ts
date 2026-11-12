import { describe, expect, it } from "vitest";

import { decisionGateStep, type DecisionSession } from "@/lib/gate-decision";
import { GATE_APPROVED_WAKE_TEMPLATES } from "@/lib/chat-reference";
import { GATE_STEPS, buildGateStatus } from "@/lib/wizard-state-machine";

const wake = (gate: number) => ({
  role: "user",
  content: GATE_APPROVED_WAKE_TEMPLATES[0].replace("{n}", String(gate)),
});
const reply = { role: "assistant", content: "Dokumentaatio on päivitetty." };

function session(step: number, over: Partial<DecisionSession> = {}): DecisionSession {
  return { step, gateStatus: buildGateStatus(step), messages: [], ...over };
}

describe("decisionGateStep", () => {
  it("is the gate the session stands on, until it is approved", () => {
    for (const step of GATE_STEPS) {
      expect(decisionGateStep(session(step))).toBe(step);
      expect(decisionGateStep(session(step, { gateStatus: { ...buildGateStatus(step), [step]: "rejected" } }))).toBe(
        step,
      );
      expect(
        decisionGateStep(session(step, { gateStatus: { ...buildGateStatus(step), [step]: "approved" } })),
      ).toBeUndefined();
    }
  });

  it("offers no decision on the steps the wizard works through", () => {
    for (const step of [1, 2, 3, 5, 6, 7, 8]) {
      expect(decisionGateStep(session(step, { lastSuccessfulRun: "run-1", messages: [wake(3), reply] }))).toBeUndefined();
    }
  });

  it("offers Gate 3 from the PoC step once a test run has succeeded", () => {
    expect(decisionGateStep(session(10))).toBeUndefined();
    expect(decisionGateStep(session(10, { lastSuccessfulRun: null }))).toBeUndefined();
    expect(decisionGateStep(session(10, { lastSuccessfulRun: "run-1" }))).toBe(11);
  });

  it("offers Gate 4 from the documentation step once the wizard has replied to Gate 3's approval", () => {
    // Just approved: the wizard has not answered yet.
    expect(decisionGateStep(session(12, { messages: [reply, wake(3)] }))).toBeUndefined();
    expect(decisionGateStep(session(12, { messages: [reply] }))).toBeUndefined();
    expect(decisionGateStep(session(12, { messages: [wake(3), reply] }))).toBe(13);
    // A later exchange keeps it, as long as the wizard has the last word.
    const later = [wake(3), reply, { role: "user", content: "Lisää vielä ohje." }];
    expect(decisionGateStep(session(12, { messages: later }))).toBeUndefined();
    expect(decisionGateStep(session(12, { messages: [...later, reply] }))).toBe(13);
    // Not while it is replying, and not for another gate's approval.
    expect(
      decisionGateStep(session(12, { messages: [wake(3), reply], pendingTurn: { userMessage: "x" } })),
    ).toBeUndefined();
    expect(decisionGateStep(session(12, { messages: [wake(2), reply] }))).toBeUndefined();
  });
});
