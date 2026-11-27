import { describe, expect, it } from "vitest";
import type { BpmnMapping } from "@/lib/bpmn-canvas-ops";
import {
  derivedChatReference,
  derivedNote,
  endChoiceLabel,
  endChoiceNote,
  endLeadsTo,
  isDerivedElement,
} from "@/lib/bpmn-derived";
import { quoteOneLine } from "@/lib/chat-template";
import { dictionary } from "@/lib/i18n";

const t = dictionary("en");

describe("derivedNote", () => {
  it("says why the PDF box is drawn", () => {
    expect(derivedNote("pdf_generation", t)).toBe(
      "Drawn because the solution's output includes a PDF report. Ask the wizard to change it.",
    );
  });

  it("says why a send task is drawn", () => {
    expect(derivedNote("send_task", t)).toBe(
      "Drawn because the solution sends its result to another system. Ask the wizard to change it.",
    );
  });

  it("says the approval after a review is drawn from the review step", () => {
    expect(derivedNote("approval_gateway", t)).toBe(
      "The decision after a human review, drawn from the review step. Change the review step or ask the wizard.",
    );
  });

  it("falls back to the general text for any other kind, or none", () => {
    expect(derivedNote("end_event", t)).toBe(t.bpmnDerivedElement);
    expect(derivedNote(undefined, t)).toBe(t.bpmnDerivedElement);
  });
});

describe("isDerivedElement", () => {
  const steps = [
    { id: "review", name: "Review" },
    { id: "check", name: "Fields complete?" },
  ];
  const mapping: BpmnMapping = {
    Activity_review: { kind: "user_task", blueprint_path: "workflow.steps[0]" },
    Gateway_check: { kind: "decision", blueprint_path: "workflow.steps[1]" },
    Gateway_amount: { kind: "decision_point", blueprint_path: "workflow.decisions[0]", decision: { id: "amount", name: "Amount", after: "review", branches: [] } },
    DataObjectRef_invoice: { kind: "data_object", blueprint_path: "derived:data", data_object: { id: "invoice", label: "" } },
    Activity_generate_pdf: { kind: "pdf_generation", blueprint_path: "derived:pdf" },
    Gateway_review_approval: { kind: "approval_gateway", blueprint_path: "derived:approval:review" },
  };

  it("is true for a box the generator draws from elsewhere", () => {
    expect(isDerivedElement("Activity_generate_pdf", mapping, steps)).toBe(true);
    expect(isDerivedElement("Gateway_review_approval", mapping, steps)).toBe(true);
  });

  it("is false for a step, also one drawn as a gateway, a business decision and a data object", () => {
    expect(isDerivedElement("Activity_review", mapping, steps)).toBe(false);
    expect(isDerivedElement("Gateway_check", mapping, steps)).toBe(false);
    expect(isDerivedElement("Gateway_amount", mapping, steps)).toBe(false);
    expect(isDerivedElement("DataObjectRef_invoice", mapping, steps)).toBe(false);
  });
});

describe("what a decision branch to the end leads to", () => {
  const fi = dictionary("fi");
  const pdf: BpmnMapping = { Activity_generate_pdf: { kind: "pdf_generation", blueprint_path: "derived:pdf_output" } };
  const send: BpmnMapping = {
    Activity_submit_erp: { kind: "send_task", blueprint_path: "derived:submit:erp" },
  };

  it("reads the report and the delivery from the boxes the generator draws", () => {
    expect(endLeadsTo({})).toEqual({ report: false, delivery: false });
    expect(endLeadsTo(pdf)).toEqual({ report: true, delivery: false });
    expect(endLeadsTo(send)).toEqual({ report: false, delivery: true });
    expect(endLeadsTo({ ...pdf, ...send })).toEqual({ report: true, delivery: true });
  });

  it("explains explicit finishing work at the step or decision being edited", () => {
    const mapping: BpmnMapping = {
      Activity_review: {
        kind: "human_review", blueprint_path: "workflow.steps[0]",
        done_report: "conditional", done_delivery: "conditional",
      },
      Gateway_finish: {
        kind: "decision_point", blueprint_path: "business_process.decision_points[0]",
        decision: { id: "finish", after: "deliver", name: "Finish", branches: [] },
        done_report: "complete", done_delivery: "complete",
      },
    };
    const early = endLeadsTo(mapping, { after: "review" }, [{ id: "review" }]);
    const late = endLeadsTo(mapping, { decision: { id: "finish" } });
    expect(endChoiceNote(early, t)).toContain(
      "If this branch skips the report step, a report can be added at the end.",
    );
    expect(endChoiceNote(early, t)).toContain(
      "If this branch skips a delivery step, a delivery can be added at the end.",
    );
    expect(endChoiceNote(late, t)).toContain("The report is already complete at this point.");
    expect(endChoiceNote(late, t)).toContain("The workflow’s own delivery steps have already run at this point.");
    expect(endChoiceNote(late, fi)).toContain("Raportti on jo valmis tässä kohdassa.");
  });

  it("names the end choice by what follows it", () => {
    expect(endChoiceLabel({ report: true, delivery: true }, fi)).toBe("Valmis: raportti ja vienti");
    expect(endChoiceLabel({ report: true, delivery: false }, fi)).toBe("Valmis: raportti");
    expect(endChoiceLabel({ report: false, delivery: true }, fi)).toBe("Valmis: vienti");
    expect(endChoiceLabel({ report: false, delivery: false }, fi)).toBe("Valmis");
    expect(endChoiceLabel({ report: true, delivery: true }, t)).toBe("Done: report and delivery");
    expect(endChoiceLabel({ report: false, delivery: false }, t)).toBe("Done");
  });

  it("says where a case that ends without a result goes, only when something follows the end", () => {
    expect(endChoiceNote({ report: true, delivery: true }, fi)).toBe(
      "Valmis kulkee raportin ja viennin kautta. Jos käsittely päättyy ilman tulosta, lisää hylkäyspolku.",
    );
    expect(endChoiceNote({ report: false, delivery: true }, fi)).toBe(
      "Valmis kulkee viennin kautta. Jos käsittely päättyy ilman tulosta, lisää hylkäyspolku.",
    );
    expect(endChoiceNote({ report: true, delivery: false }, t)).toBe(
      "Done goes through the report. If handling ends without a result, add a rejection path.",
    );
    expect(endChoiceNote({ report: false, delivery: false }, fi)).toBeNull();
  });
});

describe("derivedChatReference", () => {
  it("names the element and quotes its name, which the agent wrote", () => {
    const ref = derivedChatReference("Activity_generate_pdf", 'Generate "PDF" report', t);
    expect(ref.key).toBe("bpmn:Activity_generate_pdf");
    expect(ref.label).toBe(quoteOneLine('Generate "PDF" report', 60));
    expect(ref.prefix).toBe(
      `About the diagram element ${quoteOneLine('Generate "PDF" report')}, drawn from the blueprint: `,
    );
  });

  it("uses the element id when the box has no name", () => {
    expect(derivedChatReference("Activity_generate_pdf", "", t).label).toBe(quoteOneLine("Activity_generate_pdf", 60));
  });
});
