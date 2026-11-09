"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CHAT_SEND_EVENT } from "./chat-dock";
import { Icon } from "./icons";

export type RequirementAnswerLabels = {
  answer: string;
  send: string;
  cancel: string;
  placeholder: string;
  sent: string;
  /** "{question}" and "{answer}" are filled in: the chat message sent. */
  message: string;
};

/**
 * Answer one requirement point right in the checklist. The answer goes to the
 * chat as an ordinary message naming the point, so the agent records it the
 * same way as an answer typed in the chat.
 */
export function RequirementAnswer({
  question,
  labels,
}: {
  question: string;
  labels: RequirementAnswerLabels;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();

  useEffect(() => {
    if (open) fieldRef.current?.focus();
  }, [open]);

  function submit() {
    const answer = text.trim();
    if (!answer) return;
    const message = labels.message.replace("{question}", question).replace("{answer}", answer);
    window.dispatchEvent(new CustomEvent(CHAT_SEND_EVENT, { detail: message }));
    setText("");
    setOpen(false);
    setSent(true);
  }

  if (!open) {
    return (
      <div className="mt-1 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setOpen(true);
          }}
          className="inline-flex items-center gap-1 rounded text-xs font-medium text-brand-text hover:underline"
        >
          <Icon name="messageSquareText" size={13} />
          {labels.answer}
        </button>
        {sent && (
          <span role="status" className="inline-flex items-center gap-1 text-xs text-text-muted">
            <Icon name="check" size={12} />
            {labels.sent}
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
