"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { gateNumber } from "@/lib/wizard-state-machine";
import { decisionGateStep, type DecisionSession } from "@/lib/gate-decision";
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
 */
function gateStillOpen(session: DecisionSession, step: number): boolean {
  return decisionGateStep(session) === step;
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
  try {
    // Decided from the step before the gate: the session moves onto it first.
    if (owned.session.step < step) await advanceSession(id);
    const after = await approveGate(id);
    approved = after?.gateStatus[step] === "approved";
  } catch (err) {
    notice = noticeFor(err);
    if (!notice) throw err;
  }
  refresh();
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
  try {
    // Decided from the step before the gate: the session moves onto it first.
    if (owned.session.step < step) await advanceSession(id);
    after = await rejectGate(id);
  } catch {
    // The page says the rejection was not saved; the reason stays in its form.
    return "failed";
  }
  refresh();
  return after?.gateStatus[step] === "rejected" ? "saved" : "failed";
}
