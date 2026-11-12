"use client";

import { useId, useState } from "react";
import { answersMessage, type AnswerTemplate, type Question } from "@/lib/chat-questions";
import { Icon } from "./icons";

export type ChatQuestionLabels = AnswerTemplate & {
  /** The button under a message with several questions; "{count}" is filled in. */
  open: string;
  send: string;
  close: string;
  placeholder: string;
  /** Says that an empty field is sent as skipped. */
  skipHint: string;
  /** Shown with the reason when the answers did not reach the agent; they are kept. */
  failed: string;
};

/**
 * Answer fields for a round of questions in the latest assistant message. The
 * answers go as one chat message, numbered like the questions; a field left
 * empty is sent as skipped. Free text in the chat field still works as before.
 * The panel keeps this form in place while its answers are on their way, and
 * until they have reached the agent: a send that fails leaves them here.
 *
 * The fields are there as soon as the wizard has asked: they used to wait
 * behind a "answer one by one" link that had to be found and clicked first.
 * "Close" folds them back to that link for someone who would rather write
 * freely in the chat field.
 */
export function ChatQuestions({
  questions,
  labels,
  disabled,
  onSend,
}: {
  questions: Question[];
  labels: ChatQuestionLabels;
  /** A reply is still streaming. */
  disabled: boolean;
  /** Sends the message; resolves null once the agent has it, or why it never did. */
  onSend: (message: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(true);
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [sending, setSending] = useState(false);
  // Why the last send did not reach the agent, as the chat would say it.
  const [failed, setFailed] = useState<string | null>(null);
  const baseId = useId();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 rounded text-xs font-medium text-brand-text hover:underline"
        data-testid="chat-questions-open"
      >
        <Icon name="listChecks" size={14} />
        {labels.open.replace("{count}", String(questions.length))}
      </button>
    );
  }

  const anyAnswer = answers.some((a) => a.trim());

  async function submit() {
    if (!anyAnswer || sending) return;
    setSending(true);
    setFailed(null);
    const reason = await onSend(answersMessage(questions, answers, labels));
    setSending(false);
    if (reason === null) {
      setAnswers(questions.map(() => ""));
      setOpen(false);
    } else {
      setFailed(reason);
    }
  }

  return (
    <form
      className="mt-3 flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
      data-testid="chat-questions"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <ol className="flex flex-col gap-3">
        {questions.map((question, i) => (
          <li key={i} className="flex flex-col gap-1">
            <label htmlFor={`${baseId}-${i}`} className="text-xs font-medium text-text">
              <span className="text-text-muted">{question.n}. </span>
              {question.text}
            </label>
            <textarea
              id={`${baseId}-${i}`}
              rows={1}
              value={answers[i]}
              onChange={(e) =>
                setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))
              }
              placeholder={labels.placeholder}
              readOnly={sending}
              className="input-field resize-y text-sm"
            />
          </li>
        ))}
      </ol>
      {failed && (
        <p role="alert" className="text-xs text-danger-text">
          {labels.failed} {failed}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="btn-brand px-3 py-1.5 text-xs"
          disabled={disabled || sending || !anyAnswer}
          aria-busy={sending || undefined}
        >
          <Icon name={sending ? "loaderCircle" : "send"} size={14} className={sending ? "animate-spin" : ""} />
          {labels.send}
        </button>
        <button
          type="button"
          className="btn-ghost px-3 py-1.5 text-xs"
          disabled={sending}
          onClick={() => setOpen(false)}
        >
          {labels.close}
        </button>
        <span className="text-xs text-text-muted">{labels.skipHint}</span>
      </div>
    </form>
  );
}
