import { describe, expect, it } from "vitest";
import {
  NO_RUN_OUTPUT,
  documentSections,
  fieldLabel,
  hasRunOutput,
  pocRunOutput,
  recordRows,
  runEndMessage,
  valueText,
} from "./poc-run-output";

// The PoC tab showed a finished run as its raw log, with the result somewhere
// in it. These pin how the api's reading of the output block is taken in and
// turned into something a person reads.

describe("pocRunOutput", () => {
  it("is empty for nothing, garbage and a run that wrote no files", () => {
    expect(pocRunOutput(null)).toEqual(NO_RUN_OUTPUT);
    expect(pocRunOutput("x")).toEqual(NO_RUN_OUTPUT);
    const none = pocRunOutput({ run_id: "r1", record: null, files: [] });
    expect(none.runId).toBe("r1");
    expect(hasRunOutput(none)).toBe(false);
  });

  it("keeps the record, the check, the texts and the files the api read", () => {
    const o = pocRunOutput({
      run_id: "r1",
      record: { location: "Hall 3", urgency: "high" },
      validation: { passed: false, issues: ["x"] },
      transcript: "said this",
      document: "# Summary",
      files: [
        { name: "ticket.json", body: "{}" },
        { name: "bad", body: 3 },
        "not a file",
      ],
    });
    expect(o.record).toEqual({ location: "Hall 3", urgency: "high" });
    expect(o.validation?.passed).toBe(false);
    expect(o.transcript).toBe("said this");
    expect(o.document).toBe("# Summary");
    expect(o.files).toEqual([{ name: "ticket.json", body: "{}" }]);
    expect(hasRunOutput(o)).toBe(true);
  });

  it("takes several records as a list and drops a record that is not an object", () => {
    expect(pocRunOutput({ record: [{ a: 1 }, { a: 2 }], files: [] }).record).toEqual([{ a: 1 }, { a: 2 }]);
    expect(pocRunOutput({ record: "text", files: [] }).record).toBeNull();
    expect(pocRunOutput({ record: [{ a: 1 }, "x"], files: [] }).record).toBeNull();
  });
});

describe("the record as rows", () => {
  it("labels the fields and writes the values as text", () => {
    expect(fieldLabel("incident_location")).toBe("Incident location");
    expect(fieldLabel("dueDate")).toBe("Due date");
    expect(valueText(null)).toBe("");
    expect(valueText(3)).toBe("3");
    expect(valueText(["a", "b"])).toBe("a, b");
    expect(valueText({ k: 1 })).toBe('{\n  "k": 1\n}');
    expect(recordRows({ po_number: "PO-1", lines: [{ n: 1 }] })).toEqual([
      { field: "po_number", label: "Po number", value: "PO-1" },
      { field: "lines", label: "Lines", value: '[\n  {\n    "n": 1\n  }\n]' },
    ]);
  });

  it("reads a document result as sections, and an ordinary record as none", () => {
    expect(documentSections({ sections: [{ title: "A", text: "one" }, { text: "two" }] })).toEqual([
      { title: "A", text: "one" },
      { title: "2", text: "two" },
    ]);
    expect(documentSections({ location: "Hall 3" })).toBeNull();
    expect(documentSections({ sections: [] })).toBeNull();
  });
});

describe("runEndMessage", () => {
  it("prefers the reason read from the log over the Job's own words", () => {
    expect(
      runEndMessage({ phase: "failed", reason: "KeyError: 'x.pdf'", message: "backoff limit" }),
    ).toBe("KeyError: 'x.pdf'");
    expect(runEndMessage({ phase: "failed", message: "backoff limit" })).toBe("backoff limit");
    expect(runEndMessage({ phase: "timeout", reason: "the run passed its ten-minute limit" })).toBe(
      "the run passed its ten-minute limit",
    );
    expect(runEndMessage({ phase: "failed", reason: "  ", message: "" })).toBeNull();
  });

  it("keeps the Job's message for a run that succeeded", () => {
    expect(runEndMessage({ phase: "succeeded", reason: "stale", message: null })).toBeNull();
  });
});
