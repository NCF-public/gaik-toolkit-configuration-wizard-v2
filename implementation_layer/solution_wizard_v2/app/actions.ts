"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { createSession } from "@/lib/sessions";
import { audit } from "@/lib/audit";
import { getIncomingTraceId } from "@/lib/request-context";

export async function startSession(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const title = (formData.get("title") as string) ?? "";
  const session = await createSession(user.email, title);
  audit("session.create", {
    actor: user.email,
    resource: { type: "session", id: session.id },
    outcome: "success",
    traceId: await getIncomingTraceId(),
  });
  redirect(`/sessions/${session.id}`);
}
