import { describe, expect, it } from "vitest";
import type { BpmnMapping } from "@/lib/bpmn-canvas-ops";
import { derivedChatReference, derivedNote, isDerivedElement } from "@/lib/bpmn-derived";
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
