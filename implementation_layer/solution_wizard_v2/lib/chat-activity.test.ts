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
  steps: "What the wizard did ({n})",
  files: { "use_case.blueprint.json": "the solution plan", "output_schema.py": "the fields to extract" },
  diagram: "Diagram",
  diagramSteps: "Diagram, steps in order: {steps}",
  diagramDrawing: "Drawing the diagram",
  diagramExpand: "Enlarge",
  diagramClose: "Close",
  panel: {
    hint: "",
    referenceRemove: "",
    background: "",
    nonTechnical: "",
    nonTechnicalText: "",
    technical: "",
    technicalText: "",
    gateApproved: "",
  },
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

  it("names the file when there is one, in plain words when it is one the wizard writes", () => {
    expect(activityText({ kind: "write", file: "output_schema.py" }, labels)).toBe("Writing the fields to extract");
    expect(activityText({ kind: "read", file: "use_case.blueprint.json" }, labels)).toBe("Reading the solution plan");
    expect(activityText({ kind: "write", file: null }, labels)).toBe("Writing a file");
    expect(activityText({ kind: "read", file: "a.json" }, labels)).toBe("Reading a.json");
    expect(activityText({ kind: "read", file: "raportti.pdf" }, labels)).toBe("Reading raportti.pdf");
    // A name is a key of the map only when it is one of its own entries.
    expect(activityText({ kind: "read", file: "constructor" }, labels)).toBe("Reading constructor");
    expect(activityText({ kind: "write", file: "$&.py" }, labels)).toBe("Writing $&.py");
    expect(activityText({ kind: "run", file: null }, labels)).toBe("Running a check");
    expect(activityText({ kind: "work", file: null }, labels)).toBe("Working on it");
  });

  it("shows the time only once the wait is noticeable", () => {
    expect(elapsedText(3, labels)).toBeNull();
    expect(elapsedText(45.7, labels)).toBe("45 s");
  });
});
