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
      "Ends the whole case immediately, including parallel work.",
    );
    expect(endChoiceNote(early, t)).toContain(
      "No later report or delivery steps run.",
    );
    expect(endChoiceNote(late, t)).toContain("The report is already complete at this point.");
    expect(endChoiceNote(late, t)).toContain("The workflow’s own delivery steps have already run at this point.");
    expect(endChoiceNote(late, fi)).toContain("Raportti on jo valmis tässä kohdassa.");
  });

  it("names the explicit stop independently of the normal finishing tasks", () => {
    for (const report of [false, true]) {
      for (const delivery of [false, true]) {
        expect(endChoiceLabel({ report, delivery }, fi)).toBe("Päätä käsittely");
        expect(endChoiceLabel({ report, delivery }, t)).toBe("End case");
      }
    }
  });

  it("always explains that an explicit end stops parallel work and future outputs", () => {
    expect(endChoiceNote({ report: true, delivery: true }, fi)).toBe(
      fi.bpmnDecisionStopNote,
    );
    expect(endChoiceNote({ report: false, delivery: true }, fi)).toBe(
      fi.bpmnDecisionStopNote,
    );
    expect(endChoiceNote({ report: true, delivery: false }, t)).toBe(
      "Ends the whole case immediately, including parallel work. No later report or delivery steps run.",
    );
    expect(endChoiceNote({ report: false, delivery: false }, fi)).toBe(fi.bpmnDecisionStopNote);
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
