import {
  dataObjectOf,
  decisionOf,
  exceptionOf,
  stepIdOf,
  type BpmnMapping,
  type DoneWork,
  type StepRef,
} from "@/lib/bpmn-canvas-ops";
import type { ChatReference } from "@/lib/chat-events";
import { fillTemplate, quoteOneLine } from "@/lib/chat-template";
import type { Dict } from "@/lib/i18n";

/**
 * What the diagram's properties say about a box the generator draws by
 * itself, from another part of the blueprint (the mapping's `kind`): the PDF
 * report's task, a send task for an integration target, the approval after a
 * review. Such a box has no tools on the canvas, so it says why and offers
 * the chat.
 */
export type DerivedTexts = Pick<
  Dict,
  "bpmnDerivedPdf" | "bpmnDerivedSend" | "bpmnDerivedApproval" | "bpmnDerivedElement" | "bpmnDerivedChatPrefix"
>;

const NOTES: Record<string, keyof DerivedTexts> = {
  pdf_generation: "bpmnDerivedPdf",
  send_task: "bpmnDerivedSend",
  approval_gateway: "bpmnDerivedApproval",
};

/**
 * Whether `elementId` is a box the generator draws from elsewhere in the
 * blueprint: not a step (a decision step is drawn as a gateway), a business
 * decision or a data object, which are edited on the diagram.
 */
export function isDerivedElement(elementId: string, mapping: BpmnMapping, steps: StepRef[]): boolean {
  return (
    !stepIdOf(elementId, mapping, steps) &&
    !decisionOf(elementId, mapping) &&
    !exceptionOf(elementId, mapping) &&
    !dataObjectOf(elementId, mapping)
  );
}

/** What the diagram's successful end passes before it ends: the report, a delivery, both or neither. */
export type EndLeadsTo = { report: boolean; delivery: boolean; ownReport?: DoneWork; ownDelivery?: DoneWork };

/**
 * What a decision branch to the end leads to, read from the boxes the
 * generator draws (`pdf_generation`, `send_task`): every successful path passes
 * them on its way to the end, a branch to the end included. The mapping also
 * describes any report or delivery covered by explicit steps at the anchor.
 */
export function endLeadsTo(
  mapping: BpmnMapping,
  anchor?: { after: string } | { decision: { id: string } },
  steps: StepRef[] = [],
): EndLeadsTo {
  const kinds = new Set(Object.values(mapping).map((entry) => entry?.kind));
  const leads: EndLeadsTo = { report: kinds.has("pdf_generation"), delivery: kinds.has("send_task") };
  if (!anchor) return leads;
  const elementId = Object.keys(mapping).find((id) =>
    "after" in anchor ? stepIdOf(id, mapping, steps) === anchor.after : mapping[id]?.decision?.id === anchor.decision.id,
  );
  const entry = elementId && mapping[elementId];
  if (entry && entry.done_report) leads.ownReport = entry.done_report;
  if (entry && entry.done_delivery) leads.ownDelivery = entry.done_delivery;
  return leads;
}

export type EndChoiceTexts = Pick<
  Dict,
  | "bpmnDecisionEnd"
  | "bpmnDecisionEndReportDelivery"
  | "bpmnDecisionEndReport"
  | "bpmnDecisionEndDelivery"
  | "bpmnDecisionEndNoteReportDelivery"
  | "bpmnDecisionEndNoteReport"
  | "bpmnDecisionEndNoteDelivery"
  | "bpmnDecisionEndNoteSuccess"
  | "bpmnDecisionEndReportComplete"
  | "bpmnDecisionEndReportConditional"
  | "bpmnDecisionEndDeliveryComplete"
  | "bpmnDecisionEndDeliveryConditional"
>;

/** The branch dialog's end choice: "done", with what follows it. */
export function endChoiceLabel(leads: EndLeadsTo, t: EndChoiceTexts): string {
  if (leads.report && leads.delivery) return t.bpmnDecisionEndReportDelivery;
  if (leads.report) return t.bpmnDecisionEndReport;
  if (leads.delivery) return t.bpmnDecisionEndDelivery;
  return t.bpmnDecisionEnd;
}

/** Explain the successful end and any finishing actions already covered by the workflow. */
export function endChoiceNote(leads: EndLeadsTo, t: EndChoiceTexts): string | null {
  const notes: string[] = [];
  if (leads.report && leads.delivery) notes.push(t.bpmnDecisionEndNoteReportDelivery);
  else if (leads.report) notes.push(t.bpmnDecisionEndNoteReport);
  else if (leads.delivery) notes.push(t.bpmnDecisionEndNoteDelivery);
  else if (leads.ownReport || leads.ownDelivery) notes.push(t.bpmnDecisionEndNoteSuccess);
  if (leads.ownReport) {
    notes.push(leads.ownReport === "complete" ? t.bpmnDecisionEndReportComplete : t.bpmnDecisionEndReportConditional);
  }
  if (leads.ownDelivery) {
    notes.push(leads.ownDelivery === "complete" ? t.bpmnDecisionEndDeliveryComplete : t.bpmnDecisionEndDeliveryConditional);
  }
  return notes.length ? notes.join(" ") : null;
}

/** Why the box of mapping kind `kind` is drawn; the general text for any other kind. */
export function derivedNote(kind: string | undefined, t: DerivedTexts): string {
  const key = kind && Object.prototype.hasOwnProperty.call(NOTES, kind) ? NOTES[kind] : "bpmnDerivedElement";
  return t[key];
}

/**
 * The chat reference for asking about the box `elementId`. Its name comes
 * from the agent's blueprint, so it travels as a one-line quote.
 */
export function derivedChatReference(elementId: string, name: string, t: DerivedTexts): ChatReference {
  const shown = name || elementId;
  return {
    key: `bpmn:${elementId}`,
    label: quoteOneLine(shown, 60),
    prefix: fillTemplate(t.bpmnDerivedChatPrefix, { name: quoteOneLine(shown) }),
  };
}
