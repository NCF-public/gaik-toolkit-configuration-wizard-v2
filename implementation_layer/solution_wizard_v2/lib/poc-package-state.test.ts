import { describe, expect, it } from "vitest";
import { NO_POC_PACKAGE, pocPackageState } from "./poc-package-state";

describe("pocPackageState", () => {
  it("is not generated for nothing, garbage and generated:false", () => {
    expect(pocPackageState(null)).toEqual(NO_POC_PACKAGE);
    expect(pocPackageState("x")).toEqual(NO_POC_PACKAGE);
    expect(pocPackageState({ generated: false, files: ["a"] })).toEqual(NO_POC_PACKAGE);
  });

  it("a package the api calls ready is ready", () => {
    const s = pocPackageState({ generated: true, ready: true, files: ["run_poc.py"], problems: [] });
    expect(s).toEqual({
      generated: true,
      ready: true,
      problems: [],
      files: ["run_poc.py"],
      recordedRun: null,
    });
  });

  it("an explicit ready:false is not ready and keeps the api's reasons", () => {
    const s = pocPackageState({
      generated: true,
      ready: false,
      files: ["README.md"],
      problems: ["run_poc.py is missing"],
    });
    expect(s.generated).toBe(true);
    expect(s.ready).toBe(false);
    expect(s.problems).toEqual(["run_poc.py is missing"]);
  });

  it("an answer without ready (mock store, older api) does not withhold the package", () => {
    expect(pocPackageState({ generated: true, files: ["a"] }).ready).toBe(true);
  });

  it("ignores non-string entries in files and problems", () => {
    const s = pocPackageState({ generated: true, ready: false, files: ["a", 1, null], problems: [2, "p"] });
    expect(s.files).toEqual(["a"]);
    expect(s.problems).toEqual(["p"]);
  });

  it("carries the run the api has recorded, and only a real one (#253)", () => {
    expect(pocPackageState({ generated: true, files: [], recordedRun: "20261004-abc" }).recordedRun).toBe(
      "20261004-abc",
    );
    expect(pocPackageState({ generated: true, files: [], recordedRun: "" }).recordedRun).toBeNull();
    expect(pocPackageState({ generated: true, files: [], recordedRun: 42 }).recordedRun).toBeNull();
    expect(pocPackageState({ generated: true, files: [] }).recordedRun).toBeNull();
    // A recorded run survives a package that is (temporarily) not generated.
    expect(pocPackageState({ generated: false, recordedRun: "r1" }).recordedRun).toBe("r1");
  });
});
