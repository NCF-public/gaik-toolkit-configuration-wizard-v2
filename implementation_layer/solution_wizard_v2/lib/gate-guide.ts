import type { Dict } from "@/lib/i18n";
import type { ChatReference } from "@/lib/chat-events";
import { fillTemplate, quoteOneLine } from "@/lib/chat-template";
import { STEP_COUNT, gateNumber, type GateStatus } from "@/lib/wizard-state-machine";

/** Longest rejection reason the reject form takes; the chat allows far more. */
export const REJECT_REASON_MAX = 2000;

/**
 * The one line under the phase title: what the user does now, and where. At
 * Gate 3 it follows the test run, which is the step's real task until one has
 * succeeded; once Gate 4 is approved there is only the package left to take.
 */
export function nowLine(
  t: Dict,
  step: number,
  gateStatus: Record<number, GateStatus>,
  hasSuccessfulRun: boolean,
): string {
  if (step >= STEP_COUNT && gateStatus[step] === "approved") return t.nowDone;
  const line =
    gateNumber(step) === 3 && hasSuccessfulRun ? t.nowGate3Run : (t.nowSteps[step - 1] ?? "");
  // The lines name the workspace tabs by their labels, so a renamed tab stays right.
  return fillTemplate(line, { flow: t.wsTabFlow, json: t.wsTabJson, poc: t.wsTabPoc });
}

/** A topic inside a sentence: "Ratkaisun rakenne" → "ratkaisun rakenne". */
function inSentence(topic: string): string {
  return topic.charAt(0).toLocaleLowerCase() + topic.slice(1);
}

export type GateReferenceLabels = {
  /** Each gate's business topic, Gate 1–4. */
  topics: string[];
  /** "Gate {n} · {topic}" */
  chip: string;
  /** The line the message starts with: {n} and {topic}. */
  prefix: string;
};

/**
 * A chat reference to one gate (a change request before approving, or a change
 * to an approved stage). The key is the gate's step, so asking about the same
 * gate again replaces its chip instead of adding a second one.
 */
export function gateReference(
  labels: GateReferenceLabels,
  gate: number,
  gateStep: number,
): ChatReference {
  const topic = labels.topics[gate - 1] ?? "";
  return {
    key: `gate:${gateStep}`,
    label: fillTemplate(labels.chip, { n: String(gate), topic }),
    prefix: fillTemplate(labels.prefix, { n: String(gate), topic: inSentence(topic) }),
  };
}

/**
 * The chat message a rejection becomes: the gate it rejects, then the user's
 * reason on the same line (quoteOneLine keeps it to one).
 */
export function rejectMessage(
  template: string,
  gate: number,
  topic: string,
  reason: string,
): string {
  return fillTemplate(template, {
    n: String(gate),
    topic: inSentence(topic),
    reason: quoteOneLine(reason, REJECT_REASON_MAX),
  });
}
