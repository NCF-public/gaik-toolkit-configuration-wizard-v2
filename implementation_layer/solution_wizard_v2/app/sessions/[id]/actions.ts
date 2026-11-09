"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { gateNumber } from "@/lib/wizard-state-machine";
import { WizardApiError } from "@/lib/wizard-api-client";
import { requireOwnedSession } from "@/lib/session-access";
import { afterStepAction } from "@/lib/step-redirect";
import {
  advanceSession,
  regressSession,
  approveGate,
  rejectGate,
} from "@/lib/sessions";

function refresh(id: string) {
  revalidatePath(`/sessions/${id}`);
  revalidatePath("/");
}

/** Refusals the page explains instead of failing: the agent is still working,
 * or the gate has nothing behind it yet (customer test feedback, Oct 2026). */
const NOTICE_CODES = new Set(["agent_busy", "gate_not_ready"]);

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
  refresh(id);
  const to = afterStepAction(id, { notice, hadNotice: formData.get("notice") === "1" });
  if (to) redirect(to);
}

export async function regress(formData: FormData) {
  const id = formData.get("id") as string;
  if (!(await requireOwnedSession(id))) return;
  await regressSession(id);
  refresh(id);
  const to = afterStepAction(id, { hadNotice: formData.get("notice") === "1" });
  if (to) redirect(to);
}

export async function approve(formData: FormData) {
  const id = formData.get("id") as string;
  const owned = await requireOwnedSession(id);
  if (!owned) return;
  const gate = gateNumber(owned.session.step);
  let notice: string | null = null;
  try {
    await approveGate(id);
  } catch (err) {
    notice = noticeFor(err);
    if (!notice) throw err;
  }
  refresh(id);
  // The panel is the only gate approval (#173), so the agent has to hear about
  // it: the page sends one chat turn for the approved gate (`wake`), which the
  // chat panel posts on load and then strips from the URL.
  const to = afterStepAction(id, {
    notice,
    wake: notice ? undefined : gate,
    hadNotice: formData.get("notice") === "1",
  });
  if (to) redirect(to);
}

// A rejection carries a reason. The form marks the field required, so an empty
// one only arrives from a client that bypassed it — drop it rather than record
// a rejection nobody can read (#126). The reason itself goes to the agent as a
// chat turn the page sends once the gate is marked rejected, so this says
// whether it was.
export async function reject(formData: FormData): Promise<boolean> {
  const id = formData.get("id") as string;
  const owned = await requireOwnedSession(id);
  if (!owned) return false;
  const feedback = ((formData.get("feedback") as string) ?? "").trim();
  if (!feedback) return false;
  // The gate the user was looking at. A page left open while the session moved
  // on must not reject whichever gate the session stands on now.
  const step = Number(formData.get("step"));
  if (owned.session.step !== step) {
    refresh(id);
    return false;
  }
  let after;
  try {
    after = await rejectGate(id);
  } catch {
    // The page says the rejection was not saved; the reason stays in its form.
    return false;
  }
  refresh(id);
  return after?.gateStatus[step] === "rejected";
}
