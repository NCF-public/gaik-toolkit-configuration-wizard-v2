import { describe, expect, it } from "vitest";
import { activityText, elapsedText, parseActivity, type ChatActivityLabels } from "./chat-activity";

const labels: ChatActivityLabels = {
  write: "Writing a file",
  writeFile: "Writing {file}",
  read: "Reading a file",
  readFile: "Reading {file}",
  run: "Running a check",
  search: "Looking something up",
  work: "Working on it",
  elapsed: "{s} s",
};

describe("chat activity", () => {
  it("reads the activity of a stream event and ignores anything else", () => {
    expect(parseActivity({ activity: { kind: "write", file: "output_schema.py" } })).toEqual({
      kind: "write",
      file: "output_schema.py",
    });
    expect(parseActivity({ activity: { kind: "run", file: null } })).toEqual({ kind: "run", file: null });
    expect(parseActivity({ delta: "hi" })).toBeNull();
    expect(parseActivity({ heartbeat: true })).toBeNull();
    expect(parseActivity({ activity: { kind: "delete", file: "x" } })).toBeNull();
    expect(parseActivity(null)).toBeNull();
  });

  it("names the file when there is one", () => {
    expect(activityText({ kind: "write", file: "output_schema.py" }, labels)).toBe("Writing output_schema.py");
    expect(activityText({ kind: "write", file: null }, labels)).toBe("Writing a file");
    expect(activityText({ kind: "read", file: "a.json" }, labels)).toBe("Reading a.json");
    expect(activityText({ kind: "run", file: null }, labels)).toBe("Running a check");
    expect(activityText({ kind: "work", file: null }, labels)).toBe("Working on it");
  });

  it("shows the time only once the wait is noticeable", () => {
    expect(elapsedText(3, labels)).toBeNull();
    expect(elapsedText(45.7, labels)).toBe("45 s");
  });
});
