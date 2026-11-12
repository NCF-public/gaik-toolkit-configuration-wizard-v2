import type { Dict } from "@/lib/i18n";
import type { ChatReference } from "@/lib/chat-events";
import { fillTemplate, quoteOneLine } from "@/lib/chat-template";
import { GATE_STEPS, STEP_COUNT, gateNumber, type GateStatus } from "@/lib/wizard-state-machine";

/** Longest rejection reason the reject form takes; the chat allows far more. */
export const REJECT_REASON_MAX = 2000;

/**
 * The one line under the phase title: what the user does now, and where. It
 * names what to look at, not the approval: the approve button says that. At
 * Gate 3, and on the PoC step before it, it follows the test run, which is the
 * real task until one has succeeded; once Gate 4 is approved there is only the
 * package left to take.
 * On an earlier gate that is already approved (the step came back onto it)
 * there is nothing to check again, only the way on.
 */
export function nowLine(
  t: Dict,
  step: number,
  gateStatus: Record<number, GateStatus>,
  hasSuccessfulRun: boolean,
): string {
  // The lines name the workspace tabs by their labels, so a renamed tab stays right.
  const tabs = (line: string) =>
    fillTemplate(line, { flow: t.wsTabFlow, json: t.wsTabJson, poc: t.wsTabPoc });
  const gate = gateNumber(step);
  // From the PoC step a run that succeeded is waiting for the same decision.
  const runWaits = hasSuccessfulRun && (gate === 3 || step === GATE_STEPS[2] - 1);
  if (gate && gateStatus[step] === "approved") {
    if (step < STEP_COUNT) return fillTemplate(t.nowGateApproved, { n: String(gate) });
    // The package can be taken only after a run has succeeded.
    return hasSuccessfulRun ? t.nowDone : tabs(t.nowDoneNoRun);
  }
  return tabs(runWaits ? t.nowGate3Run : (t.nowSteps[step - 1] ?? ""));
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
