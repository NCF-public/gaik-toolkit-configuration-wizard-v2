import { describe, expect, it } from "vitest";
import { allGatesApproved, stageState } from "@/lib/gate-timeline-state";

// The last gate is on the last phase (13 of 13), so the step cannot move past it.
// Before this, an approved Gate 4 still read "In progress" and "Ahead".

describe("stageState", () => {
  const gate4 = { first: 12, last: 13 };

  it("shows the final gate as approved once its status is approved", () => {
    expect(stageState(13, gate4, 13, { 13: "approved" })).toBe("approved");
  });

  it("keeps the final gate current while it waits for approval", () => {
    expect(stageState(13, gate4, 13, { 13: "pending" })).toBe("current");
    expect(stageState(13, gate4, 13, {})).toBe("current");
  });

  it("shows a stage the session has moved past as approved", () => {
    expect(stageState(12, { first: 8, last: 11 }, 11, {})).toBe("approved");
  });

  it("shows an approved gate as open again after a step back before it", () => {
    expect(stageState(10, { first: 8, last: 11 }, 11, { 11: "approved" })).toBe(
      "current",
    );
  });

  it("shows a stage the session has not reached as pending", () => {
    expect(stageState(5, gate4, 13, {})).toBe("pending");
  });

  it("treats a stage without a gate by its phases only", () => {
    expect(stageState(13, gate4, null, {})).toBe("current");
  });
});

describe("allGatesApproved", () => {
  const gates = [3, 7, 11, 13];
  const approved = {
    3: "approved",
    7: "approved",
    11: "approved",
    13: "approved",
  } as const;

  it("is true on the last gate once every gate is approved", () => {
    expect(allGatesApproved(13, gates, approved)).toBe(true);
  });

  it("is false while the last gate waits for approval", () => {
    expect(allGatesApproved(13, gates, { ...approved, 13: "pending" })).toBe(
      false,
    );
  });

  it("is false before the last gate's phase", () => {
    expect(allGatesApproved(12, gates, approved)).toBe(false);
  });

  it("is false without gates", () => {
    expect(allGatesApproved(13, [], {})).toBe(false);
  });
});
