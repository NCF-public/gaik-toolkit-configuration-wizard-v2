"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { gateNumber, type GateStatus } from "@/lib/wizard-state-machine";
import { gateDecidableFrom } from "@/lib/gate-decision";
import { WizardApiError } from "@/lib/wizard-api-client";
import { requireOwnedSession } from "@/lib/session-access";
import { afterStepAction, GATE_MOVED_NOTICE, type RejectOutcome } from "@/lib/step-redirect";
import {
  advanceSession,
  regressSession,
  approveGate,
  endAgent,
  rejectGate,
  reopenGate,
  type ReopenResult,
} from "@/lib/sessions";

// The session's own page and the sidebar, which shows each session's gates on
// every page: both are read again with the action's answer.
function refresh() {
  revalidatePath("/", "layout");
}

/** Refusals the page explains instead of failing: the agent is still working,
 * or the gate has nothing behind it yet (customer test feedback, Oct 2026). */
const NOTICE_CODES = new Set(["agent_busy", "gate_not_ready"]);

/**
 * Whether the gate the form was shown for is still the one waiting for a
 * decision. A page left open while the session moved on (another tab approved
 * the gate, or the work ended) must not decide whichever gate the session
 * stands on now, or a gate that is already approved. The gate's decision is
 * also offered from the step before Gate 3 and Gate 4 (lib/gate-decision).
 * Whether the wizard is replying is not asked here: wizard_api refuses a move
 * or an approval meanwhile, and the page then says that, not "moved on".
 */
function gateStillOpen(session: { step: number; gateStatus: Record<number, GateStatus> }, step: number): boolean {
  return gateDecidableFrom(session, step);
}

/**
 * Put the session on the gate a decision is for, when the decision was offered
 * from a step before it (the one before Gate 3 or Gate 4, any before Gate 1),
 * and say whether it stands there, undecided. Each move is made only from the
 * step the session was read on, and the decision that follows is made
 * only for this gate: two approvals of Gate 3 sent together both read the
 * session on the PoC step, and the second one, arriving after the first had
 * approved, moved the session on to Gate 4 and approved that.
 */
async function standsOnGate(
  id: string,
  session: { step: number; gateStatus: Record<number, GateStatus> },
  step: number,
): Promise<{ onGate: boolean; moved: boolean }> {
  if (session.step === step) return { onGate: true, moved: false };
  let after;
  for (let at = session.step; at < step; at++) {
    after = await advanceSession(id, at);
    // Another request moved the session meanwhile: nothing more is decided here.
    if (after?.step !== at + 1) break;
  }
  const onGate = after?.step === step && after.gateStatus[step] !== "approved";
  return { onGate, moved: onGate };
}

function noticeFor(err: unknown): string | null {
  return err instanceof WizardApiError && err.status === 409 && err.code && NOTICE_CODES.has(err.code)
    ? err.code
    : null;
}

export async function advance(formData: FormData) {
  const id = formData.get("id") as string;
  if (!(await requireOwnedSession(id))) return;
  let notice: string | null = null;
  try {
    await advanceSession(id);
  } catch (err) {
    notice = noticeFor(err);
    if (!notice) throw err;
  }
  refresh();
  const to = afterStepAction(id, { notice, hadNotice: formData.get("notice") === "1" });
  if (to) redirect(to);
}

export async function regress(formData: FormData) {
  const id = formData.get("id") as string;
  if (!(await requireOwnedSession(id))) return;
  await regressSession(id);
  refresh();
  const to = afterStepAction(id, { hadNotice: formData.get("notice") === "1" });
  if (to) redirect(to);
}

export async function approve(formData: FormData) {
  const id = formData.get("id") as string;
  const owned = await requireOwnedSession(id);
  if (!owned) return;
  if (!gateStillOpen(owned.session, Number(formData.get("step")))) {
    // Nothing is approved and no wake-up turn is sent; the page says so.
    refresh();
    redirect(afterStepAction(id, { notice: GATE_MOVED_NOTICE })!);
  }
  // The gate the form was shown for; gateStillOpen has checked it is the one waiting.
  const step = Number(formData.get("step"));
  const gate = gateNumber(step);
  let notice: string | null = null;
  let approved = false;
  let onGate = true;
  try {
    // Decided from the step before the gate: the session moves onto it first.
    ({ onGate } = await standsOnGate(id, owned.session, step));
    if (onGate) {
      const after = await approveGate(id, step);
      approved = after?.gateStatus[step] === "approved";
    }
  } catch (err) {
    notice = noticeFor(err);
    if (!notice) throw err;
  }
  refresh();
  // Another request decided this gate meanwhile: nothing was approved here.
  if (!onGate) redirect(afterStepAction(id, { notice: GATE_MOVED_NOTICE })!);
  // The panel is the only gate approval (#173), so the agent has to hear about
  // it: the page sends one chat turn for the approved gate (`wake`), which the
  // chat panel posts on load and then strips from the URL. Only when this
  // action approved it: approveGate returns without approving when the step is
  // no longer a gate.
  const to = afterStepAction(id, {
    notice,
    wake: notice || !approved ? undefined : gate,
    hadNotice: formData.get("notice") === "1",
  });
  if (to) redirect(to);
}

// "End session" once the solution is done: the wizard held for the session
// is released and the user is taken to their sessions. Refused while it is
// still replying; the page then says so.
export async function endWizard(formData: FormData) {
  const id = formData.get("id") as string;
  if (!(await requireOwnedSession(id))) return;
  const outcome = await endAgent(id);
  if (outcome !== "ended") {
    // The session stays open, and the page says why it was not ended.
    refresh();
    redirect(`/sessions/${id}?notice=${outcome === "busy" ? "agent_busy" : "end_failed"}`);
  }
  redirect("/");
}

// "Change" on an approved gate in the timeline: its approval and the later
// ones are taken back, and the page shows the session on that gate again. The
// timeline then opens the chat with the gate as the reference, where the user
// says what to change.
export async function reopen(id: string, gate: number): Promise<ReopenResult> {
  if (!Number.isInteger(gate) || gate < 1 || gate > 4) return "failed";
  if (!(await requireOwnedSession(id))) return "failed";
  const outcome = await reopenGate(id, gate);
  // Also when nothing was reopened: the page then shows where the session stands.
  refresh();
  return outcome;
}

// A rejection carries a reason. The form marks the field required, so an empty
// one only arrives from a client that bypassed it — drop it rather than record
// a rejection nobody can read (#126). The reason itself goes to the agent as a
// chat turn the page sends once the gate is marked rejected, so this says
// whether it was: "saved", "moved" when the session is no longer waiting at
// that gate (the page then shows where it stands), or "failed".
export async function reject(formData: FormData): Promise<RejectOutcome> {
  const id = formData.get("id") as string;
  const owned = await requireOwnedSession(id);
  if (!owned) return "failed";
  const feedback = ((formData.get("feedback") as string) ?? "").trim();
  if (!feedback) return "failed";
  // The gate the user was looking at.
  const step = Number(formData.get("step"));
  if (!gateStillOpen(owned.session, step)) {
    refresh();
    return "moved";
  }
  let after;
  let moved = false;
  try {
    // Decided from the step before the gate: the session moves onto it first.
    const standing = await standsOnGate(id, owned.session, step);
    moved = standing.moved;
    if (!standing.onGate) {
      refresh();
      return "moved";
    }
    after = await rejectGate(id, step);
  } catch {
    // The page says the rejection was not saved; the reason stays in its form.
    // The session may stand on the gate now (the move went through and the
    // rejection did not): the page shows it there, where the form still is,
    // rather than a step the session has left.
    if (moved) refresh();
    return "failed";
  }
  refresh();
  return after?.gateStatus[step] === "rejected" ? "saved" : "failed";
}
