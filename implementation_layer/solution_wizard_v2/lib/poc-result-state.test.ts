import { describe, expect, it, vi } from "vitest";

import {
  publishResultStale,
  resultIsStale,
  resultStaleFor,
  runWarnings,
  subscribeResultStale,
} from "@/lib/poc-result-state";

const settled = { wizardReplying: false, packageStale: false, packageVersion: "v2", resultVersion: "v2" };

describe("resultIsStale", () => {
  it("is not, for a result of the package that is there", () => {
    expect(resultIsStale(settled)).toBe(false);
  });

  it("is, while the wizard is replying or the package has not been read since its reply", () => {
    expect(resultIsStale({ ...settled, wizardReplying: true })).toBe(true);
    expect(resultIsStale({ ...settled, packageStale: true })).toBe(true);
  });

  it("is, when the package has changed since the run, until a run of the new one succeeds", () => {
    expect(resultIsStale({ ...settled, resultVersion: "v1" })).toBe(true);
    // The new package's run succeeded: the result is its own again.
    expect(resultIsStale({ ...settled, packageVersion: "v3", resultVersion: "v3" })).toBe(false);
  });

  it("does not hold an unknown version against the result", () => {
    expect(resultIsStale({ ...settled, packageVersion: null })).toBe(false);
    expect(resultIsStale({ ...settled, resultVersion: null })).toBe(false);
    expect(resultIsStale({ ...settled, packageVersion: null, resultVersion: null })).toBe(false);
  });
});

describe("runWarnings", () => {
  it("reads the messages of an answer that has them", () => {
    expect(
      runWarnings({
        run_id: "r1",
        warnings: [
          { code: "empty_fields", message: " Three fields came back empty. " },
          { code: "low_confidence", message: "One value has low confidence." },
        ],
      }),
    ).toEqual([
      { code: "empty_fields", message: "Three fields came back empty." },
      { code: "low_confidence", message: "One value has low confidence." },
    ]);
  });

  it("has none for an answer without the field, an empty list or anything else", () => {
    expect(runWarnings({ run_id: "r1" })).toEqual([]);
    expect(runWarnings({ warnings: [] })).toEqual([]);
    expect(runWarnings({ warnings: "many" })).toEqual([]);
    expect(runWarnings(null)).toEqual([]);
    expect(runWarnings("x")).toEqual([]);
  });

  it("drops an entry with no message and keeps one with no code", () => {
    expect(runWarnings({ warnings: [{ code: "x" }, { message: "  " }, null, { message: "Check the dates." }] })).toEqual([
      { code: "", message: "Check the dates." },
    ]);
  });
});

describe("the stale word between the PoC tab and the approve buttons", () => {
  it("is kept per session and told to whoever listens, once per change", () => {
    const listener = vi.fn();
    const stop = subscribeResultStale(listener);
    expect(resultStaleFor("s1")).toBe(false);

    publishResultStale("s1", true);
    publishResultStale("s1", true);
    expect(resultStaleFor("s1")).toBe(true);
    expect(resultStaleFor("s2")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    publishResultStale("s1", false);
    expect(resultStaleFor("s1")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    publishResultStale("s1", true);
    expect(listener).toHaveBeenCalledTimes(2);
    publishResultStale("s1", false);
  });
});
