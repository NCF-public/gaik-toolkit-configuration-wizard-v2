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
  /** The button beside a question that skips it, and what its field then says. */
  skipButton: string;
  skipped: string;
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
  // Questions skipped with their button. An empty field is sent as skipped
  // too; the button says so before sending, and lets a round be sent without
  // typing "skip" anywhere.
  const [skipped, setSkipped] = useState<boolean[]>(() => questions.map(() => false));
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

  // Something to send: an answer, or a question skipped on purpose.
  const anyAnswer = answers.some((a, i) => !skipped[i] && a.trim());
  const canSend = anyAnswer || skipped.some(Boolean);

  async function submit() {
    if (!canSend || sending) return;
    setSending(true);
    setFailed(null);
    const given = answers.map((a, i) => (skipped[i] ? "" : a));
    const reason = await onSend(answersMessage(questions, given, labels));
    setSending(false);
    if (reason === null) {
      setAnswers(questions.map(() => ""));
      setSkipped(questions.map(() => false));
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
      {/* Its own numbers only: inside a reply the list would get the reply's
          list numbers as well ("1. 1. ..."). */}
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {questions.map((question, i) => (
          <li key={i} className="m-0 flex flex-col gap-1.5 p-0">
            <label htmlFor={`${baseId}-${i}`} className="text-sm font-medium leading-snug text-text">
              <span className="text-text-muted">{question.n}. </span>
              {question.text}
            </label>
            <div className="flex items-start gap-2">
              <textarea
                id={`${baseId}-${i}`}
                rows={2}
                value={skipped[i] ? "" : answers[i]}
                onChange={(e) =>
                  setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))
                }
                onKeyDown={(e) => {
                  // Ctrl or Cmd with Enter sends the round; Enter alone is a new line.
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder={skipped[i] ? labels.skipped : labels.placeholder}
                readOnly={sending}
                disabled={skipped[i]}
                className="input-field min-w-0 flex-1 resize-y text-sm disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button
                type="button"
                aria-pressed={skipped[i]}
                disabled={sending}
                onClick={() => setSkipped((prev) => prev.map((s, j) => (j === i ? !s : s)))}
                data-testid={`chat-question-skip-${i}`}
                className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97] ${
                  skipped[i]
                    ? "border-brand-soft-border bg-brand-soft text-brand-text"
                    : "border-border-strong text-text-secondary hover:border-brand hover:text-brand-text"
                }`}
              >
                {skipped[i] && <Icon name="check" size={12} />}
                {labels.skipButton}
              </button>
            </div>
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
          disabled={disabled || sending || !canSend}
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
