import { describe, expect, it } from "vitest";
import {
  packageStatus,
  preflightOutcome,
  preflightProblems,
  shouldStartPreflight,
  unfinishedPreflight,
} from "./poc-preflight";

describe("packageStatus", () => {
  const base = { loaded: true, generated: true, complete: true } as const;

  it("is ready to run only once the preflight passed", () => {
    expect(packageStatus({ ...base, preflight: "ok" })).toBe("ready");
    expect(packageStatus({ ...base, preflight: "failed" })).toBe("failed");
    expect(packageStatus({ ...base, preflight: "running" })).toBe("checking");
  });

  it("keeps a check that could not finish apart from a failed one", () => {
    expect(packageStatus({ ...base, preflight: "unfinished" })).toBe("unfinished");
  });

  it("calls complete files that nobody checked a generated package, not ready", () => {
    expect(packageStatus({ ...base, preflight: "idle" })).toBe("unchecked");
  });

  it("reports loading, a missing package and missing files before any check", () => {
    expect(packageStatus({ ...base, loaded: false, preflight: "ok" })).toBe("loading");
    expect(packageStatus({ ...base, generated: false, preflight: "idle" })).toBe("missing");
    expect(packageStatus({ ...base, complete: false, preflight: "ok" })).toBe("incomplete");
  });
});

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

  it("a Job that ended without a finding did not finish, with the Job's own message as the reason", () => {
    expect(preflightOutcome("timeout", [], "the run passed its limit")).toEqual({
      phase: "unfinished",
      problems: [],
      reason: "the run passed its limit",
    });
    expect(preflightOutcome("failed", [])).toEqual({ phase: "unfinished", problems: [], reason: null });
    expect(preflightOutcome("failed", ["Traceback (most recent call last):"], "sandbox error").phase).toBe(
      "unfinished",
    );
  });

  it("findings printed before the time limit are still findings", () => {
    expect(preflightOutcome("timeout", ["PROBLEM: x"], "the run passed its limit")).toEqual({
      phase: "failed",
      problems: ["x"],
    });
  });

  it("a succeeded Job that still printed a problem is not ok", () => {
    expect(preflightOutcome("succeeded", ["PROBLEM: x"]).phase).toBe("failed");
  });
});

describe("unfinishedPreflight", () => {
  it("carries no findings, and a reason only when there is one", () => {
    expect(unfinishedPreflight()).toEqual({ phase: "unfinished", problems: [], reason: null });
    expect(unfinishedPreflight("")).toEqual({ phase: "unfinished", problems: [], reason: null });
  });
});
