"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHAT_REPLYING_EVENT,
  CHAT_SEND_DELIVERED_EVENT,
  CHAT_SEND_EVENT,
  CHAT_SEND_FAILED_EVENT,
} from "@/lib/chat-events";

/** How long the "working" state stays after the reply ends, for the page's new data to arrive. */
const SETTLE_MS = 1200;

export type PageSendState = "idle" | "sent" | "failed";

/**
 * Sends one message from a field on the page as a chat turn (CHAT_SEND_EVENT:
 * the chat owns sending) and follows what became of it: "sent" until the
 * wizard has finished the reply to it, "failed" when it never reached the
 * wizard (the sender then offers it again), "idle" otherwise. `replying` is
 * true while the wizard answers any turn, when a new send would be refused.
 */
export function usePageSend(): {
  state: PageSendState;
  replying: boolean;
  send: (message: string) => void;
  /** Back to "idle" after a failed send the user gave up on. */
  reset: () => void;
} {
  const [state, setState] = useState<PageSendState>("idle");
  const [replying, setReplying] = useState(false);
  // The message on its way, and whether the wizard has started on it.
  const last = useRef<string | null>(null);
  const delivered = useRef(false);

  useEffect(() => {
    let settle: ReturnType<typeof setTimeout> | undefined;
    const mine = (e: Event) => last.current !== null && (e as CustomEvent<string>).detail === last.current;
    const onFailed = (e: Event) => {
      if (!mine(e)) return;
      last.current = null;
      setState("failed");
    };
    const onDelivered = (e: Event) => {
      if (mine(e)) delivered.current = true;
    };
    const onReplying = (e: Event) => {
      const now = Boolean((e as CustomEvent<boolean>).detail);
      setReplying(now);
      if (now || !delivered.current) return;
      // The reply to this message is done.
      delivered.current = false;
      last.current = null;
      settle = setTimeout(() => setState("idle"), SETTLE_MS);
    };
    window.addEventListener(CHAT_SEND_FAILED_EVENT, onFailed);
    window.addEventListener(CHAT_SEND_DELIVERED_EVENT, onDelivered);
    window.addEventListener(CHAT_REPLYING_EVENT, onReplying);
    return () => {
      clearTimeout(settle);
      window.removeEventListener(CHAT_SEND_FAILED_EVENT, onFailed);
      window.removeEventListener(CHAT_SEND_DELIVERED_EVENT, onDelivered);
      window.removeEventListener(CHAT_REPLYING_EVENT, onReplying);
    };
  }, []);

  const send = useCallback((message: string) => {
    // The chat reports on a message by its trimmed text.
    const text = message.trim();
    if (!text) return;
    last.current = text;
    delivered.current = false;
    setState("sent");
    window.dispatchEvent(new CustomEvent(CHAT_SEND_EVENT, { detail: text }));
  }, []);

  const reset = useCallback(() => {
    last.current = null;
    delivered.current = false;
    setState("idle");
  }, []);

  return { state, replying, send, reset };
}
