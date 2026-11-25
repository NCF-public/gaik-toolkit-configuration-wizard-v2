import {
  dataObjectOf,
  decisionOf,
  exceptionOf,
  stepIdOf,
  type BpmnMapping,
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
