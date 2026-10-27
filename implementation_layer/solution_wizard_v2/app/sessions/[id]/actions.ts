"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { gateNumber } from "@/lib/wizard-state-machine";
import { WizardApiError } from "@/lib/wizard-api-client";
import { requireOwnedSession } from "@/lib/session-access";
import { getI18n } from "@/lib/i18n";
import { afterStepAction } from "@/lib/step-redirect";
import {
  advanceSession,
  regressSession,
  approveGate,
  rejectGate,
  requestGateChanges,
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

// Both gate objections carry a reason. The form marks the field required, so
// an empty one only arrives from a client that bypassed it — drop it rather
// than record a rejection nobody can read (#126).
export async function reject(formData: FormData) {
  const id = formData.get("id") as string;
  if (!(await requireOwnedSession(id))) return;
  const feedback = ((formData.get("feedback") as string) ?? "").trim();
  if (!feedback) return;
  const { t } = await getI18n();
  await rejectGate(id, feedback, t.gateRejectedAck);
  refresh(id);
}

export async function requestChanges(formData: FormData) {
  const id = formData.get("id") as string;
  if (!(await requireOwnedSession(id))) return;
  const feedback = ((formData.get("feedback") as string) ?? "").trim();
  if (!feedback) return;
  const { t } = await getI18n();
  await requestGateChanges(id, feedback, t.changesRequested);
  refresh(id);
}
