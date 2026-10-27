import { describe, expect, it } from "vitest";
import { afterStepAction } from "./step-redirect";

describe("afterStepAction", () => {
  it("shows a refusal as a notice", () => {
    expect(afterStepAction("s1", { notice: "agent_busy" })).toBe("/sessions/s1?notice=agent_busy");
    expect(afterStepAction("s1", { notice: "gate_not_ready", hadNotice: true })).toBe(
      "/sessions/s1?notice=gate_not_ready",
    );
  });

  it("drops an earlier notice once the step change goes through", () => {
    expect(afterStepAction("s1", { hadNotice: true })).toBe("/sessions/s1");
  });

  it("wakes the agent after a gate approval, notice or not", () => {
    expect(afterStepAction("s1", { wake: 3 })).toBe("/sessions/s1?wake=3");
    expect(afterStepAction("s1", { wake: 4, hadNotice: true })).toBe("/sessions/s1?wake=4");
  });

  it("stays on the page when there is nothing to show or clear", () => {
    expect(afterStepAction("s1", {})).toBeNull();
    expect(afterStepAction("s1", { notice: null, hadNotice: false })).toBeNull();
  });
});
