import { describe, expect, it } from "vitest";
import {
  type OutputSpec,
  type Process,
  currentTask,
  fieldProblem,
  formFields,
  isAudioInput,
  isDocument,
  isLastInput,
  isTable,
  parseInput,
  problemCount,
  rowProblems,
  shapeProcess,
  stepState,
  tableColumns,
  toCsv,
  toMarkdown,
} from "@/lib/case-process";

// A voice report reviewed by a supervisor, in the shape wizard_api reads from the BPMN.
const PROCESS: Process = {
  lanes: [
    { id: "L_user", name: "Technician", human: true },
    { id: "L_ai", name: "GenAI", human: false },
    { id: "L_rev", name: "Supervisor", human: true },
  ],
  nodes: [
    { id: "S", kind: "startEvent", name: "", lane: "L_user", inputs: [], outputs: [] },
    { id: "T_rec", kind: "userTask", name: "Record report", lane: "L_user", inputs: [], outputs: ["Report Audio"] },
    { id: "T_ext", kind: "serviceTask", name: "Extract fields", lane: "L_ai", inputs: [], outputs: [] },
    { id: "T_rev", kind: "userTask", name: "Review ticket", lane: "L_rev", inputs: [], outputs: [] },
    { id: "G", kind: "exclusiveGateway", name: "Approved?", lane: "L_rev", inputs: [], outputs: [] },
    { id: "T_pdf", kind: "serviceTask", name: "Generate PDF", lane: "L_ai", inputs: [], outputs: [] },
    { id: "E_ok", kind: "endEvent", name: "", lane: "L_rev", inputs: [], outputs: [] },
    { id: "E_no", kind: "endEvent", name: "Rejected", lane: "L_rev", inputs: [], outputs: [] },
  ],
  flows: [
    { from: "S", to: "T_rec", name: "" },
    { from: "T_rec", to: "T_ext", name: "" },
    { from: "T_ext", to: "T_rev", name: "" },
    { from: "T_rev", to: "G", name: "" },
    { from: "G", to: "E_no", name: "No" },
    { from: "G", to: "T_pdf", name: "Yes" },
    { from: "T_pdf", to: "E_ok", name: "" },
  ],
};

const SPEC: OutputSpec = {
  fields: ["location", "urgency", "seen_on", "tags", "uncertain_fields"],
  field_types: { tags: "list[string]", uncertain_fields: "list[string]" },
  required_fields: ["location", "urgency"],
  field_descriptions: { seen_on: "Date seen, DD/MM/YYYY" },
  allowed_values: { urgency: ["low", "medium", "high"] },
};

describe("the process from the BPMN", () => {
  const shaped = shapeProcess(PROCESS);

  it("follows the approve branch, so the steps read in order", () => {
    expect(shaped.steps.map((n) => n.id)).toEqual(["T_rec", "T_ext", "T_rev", "T_pdf"]);
  });

  it("takes the first user task as the input and the next as the review", () => {
    expect(shaped.inputTask?.id).toBe("T_rec");
    expect(shaped.reviewTask?.id).toBe("T_rev");
  });

  it("has a role for every lane with a user task, and none for the AI lane", () => {
    expect(shaped.roles.map((l) => l.name)).toEqual(["Technician", "Supervisor"]);
  });

  it("notices when the diagram has no way back from the review", () => {
    expect(shaped.returnInDiagram).toBe(false);
  });

  it("puts the case on the input task until it is sent, then on the review", () => {
    expect(currentTask(shaped, "draft")?.id).toBe("T_rec");
    expect(currentTask(shaped, "returned")?.id).toBe("T_rec");
    expect(currentTask(shaped, "failed")?.id).toBe("T_rec");
    expect(currentTask(shaped, "running")).toBeUndefined();
    expect(currentTask(shaped, "review")?.id).toBe("T_rev");
  });

  it("marks the AI steps current while the run is going", () => {
    const states = shaped.steps.map((n) => stepState(shaped, "running", n));
    expect(states).toEqual(["done", "current", "todo", "todo"]);
  });

  it("knows an audio input asks for recording", () => {
    expect(isAudioInput("Report Audio")).toBe(true);
    expect(isAudioInput("User Input")).toBe(false);
  });
});

describe("the review form from the output fields", () => {
  const good = { location: "Hall 3", urgency: "high", seen_on: "01/02/2026", tags: [] };

  it("leaves the uncertainty list out of the form", () => {
    expect(formFields(SPEC)).toEqual(["location", "urgency", "seen_on", "tags"]);
  });

  it("accepts a record that meets the spec", () => {
    expect(problemCount(SPEC, good)).toBe(0);
  });

  it("refuses a missing required field, a value outside the list and a wrong format", () => {
    expect(fieldProblem(SPEC, { ...good, location: " " }, "location")?.kind).toBe("required");
    expect(fieldProblem(SPEC, { ...good, urgency: "urgent" }, "urgency")?.kind).toBe("allowed");
    expect(fieldProblem(SPEC, { ...good, seen_on: "2026-02-01" }, "seen_on")).toEqual({
      kind: "format",
      detail: "DD/MM/YYYY",
    });
  });

  it("turns typed text back into the record's own types", () => {
    expect(parseInput(SPEC, "tags", "a, b,")).toEqual(["a", "b"]);
    expect(parseInput(SPEC, "location", "  ")).toBeNull();
  });

  it("exports a CSV that quotes values and opens in Excel", () => {
    const csv = toCsv({ location: 'Hall "3"', tags: ["a", "b"] });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Hall ""3""","a, b"');
  });
});

describe("a report as the result", () => {
  const report = {
    title: "Quarterly report",
    sections: [
      { id: "summary", title: "Summary", text: "All good. [kpis.xlsx]" },
      { id: "actions", title: "Actions", text: "| Action | Owner |" },
    ],
  };

  it("is told apart from a flat record", () => {
    expect(isDocument(report)).toBe(true);
    expect(isDocument({ location: "Hall 3" })).toBe(false);
  });

  it("exports as Markdown with a heading per section", () => {
    expect(toMarkdown(report)).toBe(
      "# Quarterly report\n\n## Summary\n\nAll good. [kpis.xlsx]\n\n## Actions\n\n| Action | Owner |\n",
    );
  });
});

describe("several records and nested lists", () => {
  it("counts the problems of every record in a list", () => {
    const rows = [{ location: "A", urgency: "high" }, { location: "", urgency: "low" }];
    expect(problemCount(SPEC, rows)).toBe(1);
  });

  it("writes one CSV row per record, with every column any record has", () => {
    const csv = toCsv([{ a: "1" }, { a: "2", b: [{ x: 1 }] }]);
    expect(csv.split("\n").slice(0, 3)).toEqual(["\ufeffa,b", '"1",""', '"2","[{""x"":1}]"']);
  });

  it("treats a list of objects as a table and finds its columns", () => {
    const rows = [{ name: "A", role: "PM" }, { name: "B", due: "1.1." }];
    expect(isTable(rows)).toBe(true);
    expect(isTable(["a", "b"])).toBe(false);
    expect(tableColumns(rows)).toEqual(["name", "role", "due"]);
  });

  it("does not take a list of records for a report", () => {
    expect(isDocument([{ sections: [{ text: "x" }] }])).toBe(false);
  });
});

describe("table columns named in the spec", () => {
  const spec: OutputSpec = {
    fields: ["po_number", "line_items", "line_item.form"],
    required_fields: ["po_number"],
    allowed_values: { "line_item.form": ["Flat", "Round"] },
  };
  const record = { po_number: "PO-1", line_items: [{ form: "Flat" }, { form: "Square" }] };

  it("keeps a dotted field out of the top-level form", () => {
    expect(formFields(spec)).toEqual(["po_number", "line_items"]);
  });

  it("checks the column on every row of its table", () => {
    expect(rowProblems(spec, record)).toEqual([
      { table: "line_items", row: 2, column: "form", problem: { kind: "allowed", detail: "Flat, Round" } },
    ]);
    expect(problemCount(spec, record)).toBe(1);
  });
});

describe("several people giving the input", () => {
  // Procurement uploads the figures, quality the audit, then the AI, then the review.
  const multi: Process = {
    lanes: [
      { id: "L_p", name: "Procurement", human: true },
      { id: "L_q", name: "Quality", human: true },
      { id: "L_ai", name: "GenAI", human: false },
      { id: "L_r", name: "Manager", human: true },
    ],
    nodes: [
      { id: "S", kind: "startEvent", name: "", lane: "L_p", inputs: [], outputs: [] },
      { id: "T_kpi", kind: "userTask", name: "Upload KPIs", lane: "L_p", inputs: [], outputs: ["KPI workbook"] },
      { id: "T_aud", kind: "userTask", name: "Upload audit", lane: "L_q", inputs: [], outputs: ["Audit report"] },
      { id: "T_ai", kind: "serviceTask", name: "Write report", lane: "L_ai", inputs: [], outputs: [] },
      { id: "T_rev", kind: "userTask", name: "Approve report", lane: "L_r", inputs: [], outputs: [] },
      { id: "E", kind: "endEvent", name: "", lane: "L_r", inputs: [], outputs: [] },
    ],
    flows: [
      { from: "S", to: "T_kpi", name: "" },
      { from: "T_kpi", to: "T_aud", name: "" },
      { from: "T_aud", to: "T_ai", name: "" },
      { from: "T_ai", to: "T_rev", name: "" },
      { from: "T_rev", to: "E", name: "" },
    ],
  };
  const shaped = shapeProcess(multi);

  it("gives every user task before the AI its own input step, and the next one reviews", () => {
    expect(shaped.inputTasks.map((n) => n.id)).toEqual(["T_kpi", "T_aud"]);
    expect(shaped.reviewTask?.id).toBe("T_rev");
    expect(shaped.roles.map((l) => l.name)).toEqual(["Procurement", "Quality", "Manager"]);
  });

  it("moves the case to the next person when a step is done", () => {
    expect(currentTask(shaped, "draft", [])?.id).toBe("T_kpi");
    expect(currentTask(shaped, "draft", ["T_kpi"])?.id).toBe("T_aud");
    expect(isLastInput(shaped, shaped.inputTasks[0])).toBe(false);
    expect(isLastInput(shaped, shaped.inputTasks[1])).toBe(true);
  });

  it("shows the finished step done and the next one current", () => {
    expect(shaped.steps.map((n) => stepState(shaped, "draft", n, ["T_kpi"]))).toEqual([
      "done",
      "current",
      "todo",
      "todo",
    ]);
  });

  it("sends a returned case back to the step the reviewer named", () => {
    expect(currentTask(shaped, "returned", ["T_kpi"])?.id).toBe("T_aud");
  });
});

describe("a required list", () => {
  it("is given when empty, missing when null", () => {
    const spec: OutputSpec = { fields: ["citations"], required_fields: ["citations"] };
    expect(fieldProblem(spec, { citations: [] }, "citations")).toBeNull();
    expect(fieldProblem(spec, { citations: null }, "citations")?.kind).toBe("required");
  });
});
