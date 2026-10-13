import { getCurrentUser } from "@/lib/current-user";
import { getSession, type WizardSession } from "@/lib/sessions";

/**
 * Load a session only if it belongs to the signed-in user (US-S1-01 isolation).
 * Returns undefined when unauthenticated, missing, or owned by another user.
 */
export async function getSessionForUser(
  sessionId: string,
  userId: string,
): Promise<WizardSession | undefined> {
  const session = await getSession(sessionId);
  if (!session || session.userId !== userId) {
    return undefined;
  }
  return session;
}

/** Current user + owned session, or null if denied. */
export async function requireOwnedSession(
  sessionId: string,
): Promise<{ user: { email: string }; session: WizardSession } | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const session = await getSessionForUser(sessionId, user.email);
  if (!session) return null;
  return { user, session };
}
