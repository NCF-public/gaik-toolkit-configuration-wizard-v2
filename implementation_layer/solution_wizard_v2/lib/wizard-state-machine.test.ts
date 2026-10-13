import { describe, expect, it } from "vitest";
import {
  buildGateStatus,
  transition,
  type WizardState,
} from "@/lib/wizard-state-machine";

// Build a state at a given step with gate statuses derived from that step.
function stateAt(step: number): WizardState {
  return { step, gateStatus: buildGateStatus(step) };
}

describe("transition — ADVANCE", () => {
  it("advances a non-gate step and marks a new version", () => {
    // Scenario: agent advances workflow step on phase completion.
    const t = transition(stateAt(2), "ADVANCE");
    expect(t.noop).toBe(false);
    expect(t.state.step).toBe(3);
    expect(t.advanced).toBe(true);
    // Gate statuses unchanged until a gate phase is reached.
    expect(t.state.gateStatus[4]).toBe("locked");
  });

  it("is blocked at a pending gate step", () => {
    // Scenario: Gate 1 blocks blueprint generation until approved.
    const t = transition(stateAt(4), "ADVANCE");
    expect(t.noop).toBe(true);
    expect(t.state.step).toBe(4);
    expect(t.blockedReason).toContain("Gate 1");
  });

  it("does not advance past the final step", () => {
    const t = transition(stateAt(13), "ADVANCE");
    expect(t.noop).toBe(true);
    expect(t.state.step).toBe(13);
  });
});

describe("transition — APPROVE_GATE", () => {
  it("approves a gate and advances past it", () => {
    // Scenario: approved gate unlocks next phases.
    const t = transition(stateAt(4), "APPROVE_GATE");
    expect(t.state.step).toBe(5);
    expect(t.advanced).toBe(true);
    expect(t.state.gateStatus[4]).toBe("approved");
    expect(t.done).toBe(false);
  });

  it("completes the session when the final gate is approved", () => {
    const t = transition(stateAt(13), "APPROVE_GATE");
    expect(t.state.step).toBe(13);
    expect(t.state.gateStatus[13]).toBe("approved");
    expect(t.done).toBe(true);
    expect(t.advanced).toBe(false);
  });

  it("is a no-op on a non-gate step", () => {
    expect(transition(stateAt(5), "APPROVE_GATE").noop).toBe(true);
  });
});

describe("transition — REJECT_GATE", () => {
  it("marks the current gate rejected and stays put", () => {
    const t = transition(stateAt(9), "REJECT_GATE");
    expect(t.state.step).toBe(9);
    expect(t.state.gateStatus[9]).toBe("rejected");
    expect(t.done).toBe(false);
  });
});

describe("transition — REQUEST_CHANGES", () => {
  it("steps back one from the gate for revision", () => {
    const t = transition(stateAt(4), "REQUEST_CHANGES");
    expect(t.state.step).toBe(3);
    expect(t.noop).toBe(false);
  });

  it("is a no-op off a gate step", () => {
    expect(transition(stateAt(6), "REQUEST_CHANGES").noop).toBe(true);
  });
});

describe("transition — REQUIREMENTS_COMPLETE", () => {
  it("jumps from gathering to Gate 1", () => {
    const t = transition(stateAt(2), "REQUIREMENTS_COMPLETE");
    expect(t.state.step).toBe(4);
    expect(t.state.gateStatus[4]).toBe("pending");
  });

  it("does not move once at or past Gate 1", () => {
    expect(transition(stateAt(4), "REQUIREMENTS_COMPLETE").noop).toBe(true);
    expect(transition(stateAt(7), "REQUIREMENTS_COMPLETE").noop).toBe(true);
  });
});

describe("transition — purity", () => {
  it("never mutates its input state", () => {
    const s = stateAt(4);
    const snapshot = JSON.stringify(s);
    transition(s, "APPROVE_GATE");
    transition(s, "ADVANCE");
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
