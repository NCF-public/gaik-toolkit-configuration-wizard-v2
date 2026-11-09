"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { createSession, deleteSession, listSessions } from "@/lib/sessions";
import { audit } from "@/lib/audit";
import { getIncomingTraceId } from "@/lib/request-context";
import { getI18n } from "@/lib/i18n";

export type RemoveSessionState = {
  error: "mismatch" | "busy" | "protected" | "failed" | null;
};

export async function removeSession(
  _previous: RemoveSessionState,
  formData: FormData,
): Promise<RemoveSessionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const id = String(formData.get("sessionId") ?? "");
  const typed = String(formData.get("confirmation") ?? "").trim();
  // Only a session on this user's own list, confirmed by its name.
  const session = (await listSessions(user.email)).find((s) => s.id === id);
  if (!session || typed !== session.title.trim()) return { error: "mismatch" };

  const result = await deleteSession(id);
  audit("session.delete", {
    actor: user.email,
    resource: { type: "session", id },
    outcome: result === "deleted" ? "success" : "error",
    traceId: await getIncomingTraceId(),
  });
  if (result !== "deleted") return { error: result };
  revalidatePath("/");
  return { error: null };
}

export async function startSession(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // A session started without a name gets one in the UI's language: the
  // default used to be Finnish in the English UI too.
  const { t } = await getI18n();
  const title = ((formData.get("title") as string) ?? "").trim() || t.untitledSession;
  const session = await createSession(user.email, title);
  audit("session.create", {
    actor: user.email,
    resource: { type: "session", id: session.id },
    outcome: "success",
    traceId: await getIncomingTraceId(),
  });
  redirect(`/sessions/${session.id}`);
}
