"use server";

import { requireOwnedSession } from "@/lib/session-access";
import { endAgent } from "@/lib/sessions";

export type EndSessionResult = "ended" | "busy" | "failed";

/**
 * "End session" in a session row's menu: the wizard held for one of the
 * user's own sessions is released. The session, its files and the
 * conversation stay, so the list and the open page have nothing to read
 * again. A session with no wizard to release answers "ended" too. Refused
 * ("busy") while the wizard is still replying.
 */
export async function endSession(id: string): Promise<EndSessionResult> {
  const owned = await requireOwnedSession(typeof id === "string" ? id : "");
  if (!owned) return "failed";
  return endAgent(owned.session.id);
}
