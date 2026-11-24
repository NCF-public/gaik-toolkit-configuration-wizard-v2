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
