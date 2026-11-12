"use client";

import { useEffect, useRef } from "react";
import { releaseWizard } from "@/app/(app)/sessions/[id]/actions";
import { CHAT_REPLYING_EVENT } from "@/lib/chat-events";

const storageKey = (sessionId: string) => `wizard-released:${sessionId}`;
/** Sessions released, or being released, in this page load: also for a browser with no storage. */
const settled = new Set<string>();

function alreadyReleased(sessionId: string): boolean {
  if (settled.has(sessionId)) return true;
  try {
    return window.localStorage.getItem(storageKey(sessionId)) !== null;
  } catch {
    return false;
  }
}

function rememberReleased(sessionId: string): void {
  try {
    window.localStorage.setItem(storageKey(sessionId), "1");
  } catch {
    // No storage: remembered until the page is loaded again.
  }
}

/**
 * Releases the wizard held for a finished session, once. "End session" was a
 * button on the finished solution, and users asked what it was for: a live
 * wizard is a process on the server, and they are few. Nothing is left for
 * the user to decide there, so the page does it: after the wizard's reply to
 * the last approval has ended (`replyAhead`: that reply is on its way or
 * about to be asked for), or at once for a session opened when it is already
 * done. The next message starts the wizard again by itself, so nothing is
 * shown. A refusal changes nothing on the page: a wizard that is replying is
 * asked again when the reply ends, a failure when the session is next opened.
 * Draws nothing.
 */
export function ReleaseWizardWhenDone({ sessionId, replyAhead }: { sessionId: string; replyAhead: boolean }) {
  // As the page was first drawn: a later reading of the session (the address
  // loses its one-time parameter) is not a reason to release at that moment.
  const waitForReply = useRef(replyAhead);
  useEffect(() => {
    if (alreadyReleased(sessionId)) return;
    let replying = false;
    const release = () => {
      if (alreadyReleased(sessionId)) return;
      settled.add(sessionId);
      releaseWizard(sessionId)
        .then((outcome) => {
          if (outcome === "ended") rememberReleased(sessionId);
          else settled.delete(sessionId);
        })
        .catch(() => settled.delete(sessionId));
    };
    const onReplying = (e: Event) => {
      const now = Boolean((e as CustomEvent<boolean>).detail);
      if (replying && !now) release();
      replying = now;
    };
    window.addEventListener(CHAT_REPLYING_EVENT, onReplying);
    if (!waitForReply.current) release();
    return () => window.removeEventListener(CHAT_REPLYING_EVENT, onReplying);
  }, [sessionId]);
  return null;
}
