"use server";

import { revalidatePath } from "next/cache";
import { requireOwnedSession } from "@/lib/session-access";
import {
  advanceSession,
  regressSession,
  approveGate,
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
  if (!(await requireOwnedSession(id))) return;
  await approveGate(id);
  refresh(id);
}
