import { approvedGateIn } from "@/lib/chat-reference";
import { GATE_STEPS, isGateStep, type GateStatus } from "@/lib/wizard-state-machine";

/** The step of the PoC and its test run, the one before Gate 3. */
const POC_STEP = GATE_STEPS[2] - 1;
/** The documentation step, the one before Gate 4. */
const DOCS_STEP = GATE_STEPS[3] - 1;

export type DecisionSession = {
  step: number;
  gateStatus: Record<number, GateStatus>;
  lastSuccessfulRun?: string | null;
  messages: { role: string; content: string }[];
  pendingTurn?: unknown;
  /** What Gate 1 reviews, as the wizard has recorded it so far. */
  businessContext?: unknown;
  assumptions?: readonly unknown[];
};

/**
 * Whether the wizard has recorded what Gate 1 reviews (the business context
 * or an assumption): the draft specification is there. Whether it is complete
 * enough to approve is the decision bar's to say (gate1Missing).
 */
export function specificationGathered(
  session: Pick<DecisionSession, "businessContext" | "assumptions">,
): boolean {
  return Boolean(session.businessContext) || (session.assumptions?.length ?? 0) > 0;
}

/**
 * The step of the gate whose decision the page offers now, or undefined.
 *
 * On a gate step that is the gate itself, until it is approved. Gate 3 and
 * Gate 4 also have a step before them that nothing moves the session on from:
 * the PoC step ends in a test run and the documentation step in the wizard's
 * reply, neither of which is a file the step follows. The only way onto those
 * gates was "Next step", a quiet button under the workspace, while the wizard's
 * reply said "approve it in the panel" and the panel had no approve button.
 * So the decision is offered from that step as well, once what the gate
 * reviews is there:
 *
 * - Gate 3 from the PoC step when a test run has succeeded;
 * - Gate 4 from the documentation step when the wizard has replied since
 *   Gate 3 was approved (that reply is where it finishes the documentation),
 *   and is not replying now. Not earlier: the approve button would stand where
 *   "approve the test run" was a moment ago.
 *
 * Gate 1 is offered from the steps before it once the wizard has recorded the
 * specification it reviews. A session comes to stand there with its
 * requirements gathered when it was stepped back from Gate 1: the wizard's
 * files move it on only when they show a new phase, so it stayed there, the
 * wizard said "approve Gate 1 in the panel", and the page had no approval.
 *
 * Deciding from there moves the session onto the gate first (actions.ts);
 * wizard_api's own gate rules decide as before whether the approval holds.
 */
export function decisionGateStep(session: DecisionSession): number | undefined {
  const { step, gateStatus } = session;
  if (isGateStep(step)) return gateStatus[step] === "approved" ? undefined : step;
  if (step < GATE_STEPS[0] && gateStatus[GATE_STEPS[0]] !== "approved" && specificationGathered(session)) {
    return GATE_STEPS[0];
  }
  if (step === POC_STEP && session.lastSuccessfulRun) return GATE_STEPS[2];
  if (step === DOCS_STEP && !session.pendingTurn && repliedSinceApproval(session.messages, 3)) {
    return GATE_STEPS[3];
  }
  return undefined;
}

/** The wizard's reply is the newest message, and it came after `gate` was last approved. */
function repliedSinceApproval(messages: DecisionSession["messages"], gate: number): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || !last.content.trim()) return false;
  for (let i = messages.length - 2; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && approvedGateIn(m.content) === gate) return true;
  }
  return false;
}

/**
 * Whether a decision of the gate at `gateStep` can be taken from where the
 * session stands: on the gate, on the step before Gate 3 or Gate 4, or on a
 * step before Gate 1, while the gate is not approved. This is what the server asks before it decides.
 * It is wider than `decisionGateStep`, which says when the page offers the
 * decision: a page that offered it and a wizard that started replying since
 * are not "the session has moved on". wizard_api answers that case itself
 * (the wizard is busy, or the gate has nothing behind it yet), and the page
 * then says the real reason.
 */
export function gateDecidableFrom(
  session: Pick<DecisionSession, "step" | "gateStatus">,
  gateStep: number,
): boolean {
  if (!isGateStep(gateStep) || session.gateStatus[gateStep] === "approved") return false;
  if (session.step === gateStep) return true;
  if (gateStep === GATE_STEPS[0]) return session.step < gateStep;
  const offeredAhead = gateStep === GATE_STEPS[2] || gateStep === GATE_STEPS[3];
  return offeredAhead && session.step === gateStep - 1;
}
