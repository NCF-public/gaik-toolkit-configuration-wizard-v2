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

/** Normal finishing tasks and work already completed at the chosen anchor. */
export type EndLeadsTo = { report: boolean; delivery: boolean; ownReport?: DoneWork; ownDelivery?: DoneWork };

/**
 * Read the normal finishing tasks and any report or delivery already covered
 * by explicit steps at the anchor. An explicit stop does not enter new tasks.
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
  | "bpmnDecisionStopNote"
  | "bpmnDecisionEndReportComplete"
  | "bpmnDecisionEndDeliveryComplete"
>;

/** An explicit end stops the case, rather than entering the finishing steps. */
export function endChoiceLabel(_leads: EndLeadsTo, t: EndChoiceTexts): string {
  return t.bpmnDecisionEnd;
}

/** Describe the stop and any finishing work already performed before it. */
export function endChoiceNote(leads: EndLeadsTo, t: EndChoiceTexts): string | null {
  const notes: string[] = [t.bpmnDecisionStopNote];
  if (leads.ownReport === "complete") {
    notes.push(t.bpmnDecisionEndReportComplete);
  }
  if (leads.ownDelivery === "complete") {
    notes.push(t.bpmnDecisionEndDeliveryComplete);
  }
  return notes.join(" ");
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
