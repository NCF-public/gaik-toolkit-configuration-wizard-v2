"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CHAT_SEND_EVENT, CHAT_SEND_FAILED_EVENT } from "@/lib/chat-events";
import { fillTemplate, quoteOneLine } from "@/lib/chat-template";
import { Icon } from "./icons";

export type RequirementAnswerLabels = {
  answer: string;
  send: string;
  cancel: string;
  placeholder: string;
  sent: string;
  /** Shown when the answer never reached the agent; it is kept to send again. */
  failed: string;
  /** "{n}", "{question}" and "{answer}" are filled in: the chat message sent. */
  message: string;
};

/**
 * Answer one requirement point right in the checklist. The answer goes to the
 * chat as an ordinary message naming the point, so the agent records it the
 * same way as an answer typed in the chat. The point is the agent's own text,
 * partly from uploaded material, so it goes as a quote on one line: data, not
 * the user's words.
 */
export function RequirementAnswer({
  number,
  question,
  labels,
}: {
  /** The point's place in the checklist, from 1. */
  number: number;
  question: string;
  labels: RequirementAnswerLabels;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "sent" | "failed">("idle");
  // The message last sent and its answer, taken back if it never arrives.
  const lastSent = useRef<{ message: string; answer: string } | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();

  useEffect(() => {
    if (open) fieldRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const onFailed = (e: Event) => {
      const failed = lastSent.current;
      if (!failed || (e as CustomEvent<string>).detail !== failed.message) return;
      lastSent.current = null;
      setText((current) => current || failed.answer);
      setStatus("failed");
    };
    window.addEventListener(CHAT_SEND_FAILED_EVENT, onFailed);
    return () => window.removeEventListener(CHAT_SEND_FAILED_EVENT, onFailed);
  }, []);

  function submit() {
    const answer = text.trim();
    if (!answer) return;
    const message = fillTemplate(labels.message, {
      n: String(number),
      question: quoteOneLine(question),
      answer,
    }).trim();
    lastSent.current = { message, answer };
    window.dispatchEvent(new CustomEvent(CHAT_SEND_EVENT, { detail: message }));
    setText("");
    setOpen(false);
    setStatus("sent");
  }

  if (!open) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => {
            setStatus((s) => (s === "sent" ? "idle" : s));
            setOpen(true);
          }}
          className="inline-flex items-center gap-1 rounded text-xs font-medium text-brand-text hover:underline"
        >
          <Icon name="messageSquareText" size={13} />
          {labels.answer}
        </button>
        {status === "sent" && (
          <span role="status" className="inline-flex items-center gap-1 text-xs text-text-muted">
            <Icon name="check" size={12} />
            {labels.sent}
          </span>
        )}
        {status === "failed" && (
          <span role="alert" className="inline-flex items-center gap-1 text-xs text-danger-text">
            <Icon name="circleAlert" size={12} />
            {labels.failed}
          </span>
        )}
      </div>
    );
  }

  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={fieldId} className="sr-only">
        {question}
      </label>
      {status === "failed" && (
        <p role="alert" className="text-xs text-danger-text">
          {labels.failed}
        </p>
      )}
      <textarea
        ref={fieldRef}
        id={fieldId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        rows={2}
        placeholder={labels.placeholder}
        className="input-field resize-y text-sm"
      />
      <div className="flex items-center gap-2">
        <button type="submit" className="btn-brand px-3 py-1.5 text-xs" disabled={!text.trim()}>
          <Icon name="send" size={14} />
          {labels.send}
        </button>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>
          {labels.cancel}
        </button>
      </div>
    </form>
  );
}
