/**
 * The message that starts a session, on its way from the start view to the
 * session's chat.
 *
 * A session is created by its first message, on a page that has no chat yet.
 * The start view keeps the message here under the new session's id and opens
 * the session; that page's chat takes it once and sends it as a normal chat
 * turn, so a message reaches the wizard by one path only. It travels in this
 * browser tab's sessionStorage (as lib/case-chat does), with a copy in memory
 * for a browser that blocks storage: the move between the two pages keeps this
 * module alive.
 */

export type FirstMessage = {
  text: string;
  /** Where the start view's field stood in the window, in px from its top. */
  fieldTop?: number;
};

const pendingKey = (sessionId: string) => `gaik-wizard:pending-first-message:${sessionId}`;
const inMemory = new Map<string, FirstMessage>();

function asFirstMessage(value: unknown): FirstMessage | null {
  if (!value || typeof value !== "object") return null;
  const { text, fieldTop } = value as Record<string, unknown>;
  if (typeof text !== "string" || !text.trim()) return null;
  return typeof fieldTop === "number" && Number.isFinite(fieldTop) ? { text, fieldTop } : { text };
}

/** Keeps the message for the session page's chat. */
export function keepFirstMessage(sessionId: string, message: FirstMessage): void {
  inMemory.set(sessionId, message);
  try {
    window.sessionStorage.setItem(pendingKey(sessionId), JSON.stringify(message));
  } catch {
    // Storage blocked: the copy in memory carries it.
  }
}

/** The kept message, once: it is removed as it is read. Null when there is none. */
export function takeFirstMessage(sessionId: string): FirstMessage | null {
  const remembered = inMemory.get(sessionId) ?? null;
  inMemory.delete(sessionId);
  let stored: FirstMessage | null = null;
  try {
    const key = pendingKey(sessionId);
    const kept = window.sessionStorage.getItem(key);
    if (kept !== null) {
      window.sessionStorage.removeItem(key);
      stored = asFirstMessage(JSON.parse(kept));
    }
  } catch {
    // Storage blocked or its content unreadable: the copy in memory stands.
  }
  return stored ?? remembered;
}
