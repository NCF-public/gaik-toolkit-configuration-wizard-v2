import { describe, expect, it } from "vitest";
import {
  preflightOutcome,
  preflightProblems,
  shouldStartPreflight,
} from "./poc-preflight";

describe("shouldStartPreflight", () => {
  const base = { onPocTab: true, ready: true, version: "v1", checkedVersion: null };

  it("starts for a ready package nobody has checked", () => {
    expect(shouldStartPreflight(base)).toBe(true);
  });

  it("does not start off the PoC tab, for a package that is not ready, or without a version", () => {
    expect(shouldStartPreflight({ ...base, onPocTab: false })).toBe(false);
    expect(shouldStartPreflight({ ...base, ready: false })).toBe(false);
    expect(shouldStartPreflight({ ...base, version: null })).toBe(false);
  });

  it("does not start twice for the same version, but does for a rewritten package", () => {
    expect(shouldStartPreflight({ ...base, checkedVersion: "v1" })).toBe(false);
    expect(shouldStartPreflight({ ...base, version: "v2", checkedVersion: "v1" })).toBe(true);
  });
});

describe("preflightProblems", () => {
  it("keeps only the PROBLEM lines, without the prefix", () => {
    expect(
      preflightProblems([
        "Loading",
        "PROBLEM: run_poc.py line 3: import pandas failed (ModuleNotFoundError: No module named 'pandas')",
        "=== PREFLIGHT FAILED: 1 problem(s) ===",
      ]),
    ).toEqual(["run_poc.py line 3: import pandas failed (ModuleNotFoundError: No module named 'pandas')"]);
  });
});

describe("preflightOutcome", () => {
  it("a succeeded Job with no problems is ok", () => {
    expect(preflightOutcome("succeeded", ["=== PREFLIGHT OK ==="])).toEqual({ phase: "ok", problems: [] });
  });

  it("a failed Job lists the problems from the log", () => {
    const out = preflightOutcome("failed", ["PROBLEM: schema cannot be loaded (ValidationError: x)"]);
    expect(out.phase).toBe("failed");
    expect(out.problems).toEqual(["schema cannot be loaded (ValidationError: x)"]);
  });

  it("a failed Job with no PROBLEM line still fails, with the Job's own message", () => {
    expect(preflightOutcome("timeout", [], "the run passed its limit")).toEqual({
      phase: "failed",
      problems: ["the run passed its limit"],
    });
    expect(preflightOutcome("failed", [])).toEqual({ phase: "failed", problems: [] });
  });

  it("a succeeded Job that still printed a problem is not ok", () => {
    expect(preflightOutcome("succeeded", ["PROBLEM: x"]).phase).toBe("failed");
  });
});
