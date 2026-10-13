"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { gateNumber } from "@/lib/wizard-state-machine";
import { requireOwnedSession } from "@/lib/session-access";
import { getI18n } from "@/lib/i18n";
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

export async function advance(formData: FormData) {
  const id = formData.get("id") as string;
  if (!(await requireOwnedSession(id))) return;
  await advanceSession(id);
  refresh(id);
}

export async function regress(formData: FormData) {
  const id = formData.get("id") as string;
  if (!(await requireOwnedSession(id))) return;
  await regressSession(id);
  refresh(id);
}

export async function approve(formData: FormData) {
  const id = formData.get("id") as string;
  const owned = await requireOwnedSession(id);
  if (!owned) return;
  const gate = gateNumber(owned.session.step);
  await approveGate(id);
  refresh(id);
  // The panel is the only gate approval (#173), so the agent has to hear about
  // it: the page sends one chat turn for the approved gate (`wake`), which the
  // chat panel posts on load and then strips from the URL.
  if (gate !== undefined) redirect(`/sessions/${id}?wake=${gate}`);
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
