import { describe, expect, it } from "vitest";
import { derivedChatReference, derivedNote } from "@/lib/bpmn-derived";
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
