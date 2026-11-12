"use client";

import { useEffect, useId, useState } from "react";
import { answersMessage, type AnswerTemplate, type Question } from "@/lib/chat-questions";
import { chipClass } from "./chat-start";
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
 *
 * Each question is one grid: its number, then the question, the options it
 * lists (lib/chat-questions) and the field in one column, with Skip beside
 * the field.
 */
export function ChatQuestions({
  questions,
  labels,
  disabled,
  onSend,
  enter = false,
  onEntered,
}: {
  questions: Question[];
  labels: ChatQuestionLabels;
  /** A reply is still streaming. */
  disabled: boolean;
  /** Sends the message; resolves null once the agent has it, or why it never did. */
  onSend: (message: string) => Promise<string | null>;
  /** The reply arrived just now, in answer to the user's message: the form
   *  comes in once. A form drawn again by a page update is simply there. */
  enter?: boolean;
  /** The form has come in; the panel does not ask for it again. */
  onEntered?: () => void;
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
  // As it was when the form was first drawn: a later render does not start it.
  const [entering] = useState(enter);
  useEffect(() => {
    if (enter) onEntered?.();
    // Once, as the form is first drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // An option fills the field with its words, still the user's to edit; the
  // same option again empties it. A skipped question is answered after all.
  function choose(i: number, option: string) {
    setSkipped((prev) => prev.map((s, j) => (j === i ? false : s)));
    setAnswers((prev) =>
      prev.map((a, j) => (j !== i ? a : !skipped[i] && a.trim() === option ? "" : option)),
    );
  }

  return (
    <form
      className={`mt-3 flex flex-col gap-5 rounded-xl border border-border bg-surface p-4 ${entering ? "reveal-in" : ""}`}
      data-testid="chat-questions"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <ol className="m-0 flex list-none flex-col gap-6 p-0">
        {questions.map((question, i) => (
          <li
            key={i}
            className="m-0 grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-x-2.5 gap-y-2 p-0"
          >
            <label
              id={`${baseId}-${i}-label`}
              htmlFor={`${baseId}-${i}`}
              className="col-span-full grid grid-cols-subgrid items-start text-sm font-medium leading-6 text-text"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold tabular-nums text-brand-text">
                {question.n}
                {/* Read with the question, as "2. Where…?". */}
                <span className="sr-only">. </span>
              </span>
              <span className="col-span-2 [overflow-wrap:anywhere]">{question.text}</span>
            </label>
            {question.options && (
              <div
                role="group"
                aria-labelledby={`${baseId}-${i}-label`}
                data-testid={`chat-question-options-${i}`}
                className="col-span-2 col-start-2 flex flex-wrap gap-1.5"
              >
                {question.options.map((option) => {
                  const on = !skipped[i] && answers[i].trim() === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={on}
                      disabled={sending}
                      onClick={() => choose(i, option)}
                      className={`${chipClass(on)} max-w-full text-left`}
                    >
                      {on && <Icon name="check" size={12} className="shrink-0" />}
                      <span className="min-w-0 [overflow-wrap:anywhere]">{option}</span>
                    </button>
                  );
                })}
              </div>
            )}
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
              className="input-field col-start-2 min-w-0 resize-y text-sm disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="button"
              aria-pressed={skipped[i]}
              // Described by its question: three buttons that all say "Skip"
              // tell a screen reader nothing about which one is which.
              aria-describedby={`${baseId}-${i}-label`}
              disabled={sending}
              onClick={() => setSkipped((prev) => prev.map((s, j) => (j === i ? !s : s)))}
              data-testid={`chat-question-skip-${i}`}
              className={`col-start-3 inline-flex h-9 items-center gap-1 self-start rounded-full border px-3 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97] ${
                skipped[i]
                  ? "border-brand-soft-border bg-brand-soft text-brand-text"
                  : "border-border-strong text-text-secondary hover:border-brand hover:text-brand-text"
              }`}
            >
              {skipped[i] && <Icon name="check" size={12} />}
              {labels.skipButton}
            </button>
          </li>
        ))}
      </ol>
      {failed && (
        <p role="alert" className="text-xs text-danger-text">
          {labels.failed} {failed}
        </p>
      )}
      {/* Under the fields' column, not under the numbers. */}
      <div className="flex flex-wrap items-center gap-2 sm:pl-[2.125rem]">
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
