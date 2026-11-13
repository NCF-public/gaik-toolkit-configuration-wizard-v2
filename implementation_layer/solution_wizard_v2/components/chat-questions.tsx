"use client";

import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { answersMessage, type AnswerTemplate, type Question } from "@/lib/chat-questions";
import { chipClass } from "./chat-start";
import { useGrowingField } from "./composer-card";
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
 * Each question is one grid: its number, then the question, what the wizard
 * wrote under it (lib/chat-questions: the lines it refers to, or the options
 * it lists) and the field in one column, with Skip beside the field. A field
 * is one line tall until it is written in, so a round of four questions does
 * not fill the screen.
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
      className={`mt-3 flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 ${entering ? "reveal-in" : ""}`}
      data-testid="chat-questions"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
        {questions.map((question, i) => (
          <li
            key={i}
            className="m-0 grid grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 p-0"
          >
            <label
              id={`${baseId}-${i}-label`}
              htmlFor={`${baseId}-${i}`}
              className="col-span-full grid grid-cols-subgrid items-start text-[0.8125rem] font-medium leading-5 text-text"
            >
              <span className="inline-block h-5 w-5 rounded-full bg-brand-soft text-center text-[0.6875rem] font-semibold leading-5 tabular-nums text-brand-text">
                {question.n}
                {/* Read with the question, as "2. Where…?". In the number's own
                    line of text, with no size: set apart from it (as a flex
                    item, or taken out of the flow) it is read "2 . Where…?". */}
                <span className="text-[0px]">. </span>
              </span>
              <span className="col-span-2 [overflow-wrap:anywhere]">{question.text}</span>
            </label>
            {question.details && (
              // What the question points at ("My default is:"), as the wizard wrote it.
              <ul
                id={`${baseId}-${i}-details`}
                data-testid={`chat-question-details-${i}`}
                className="col-span-2 col-start-2 m-0 list-disc space-y-0.5 p-0 pl-4 text-xs leading-5 text-text-secondary marker:text-text-muted"
              >
                {question.details.map((line, j) => (
                  <li key={j} className="m-0 p-0 [overflow-wrap:anywhere]">
                    {line}
                  </li>
                ))}
              </ul>
            )}
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
            <AnswerField
              id={`${baseId}-${i}`}
              aria-describedby={question.details ? `${baseId}-${i}-details` : undefined}
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
              // A quiet text button, as tall as the one-line field beside it;
              // pressed, it is filled and ticked.
              className={`col-start-3 inline-flex h-[2.125rem] items-center gap-1 self-start rounded-md px-2 text-xs transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 ${
                skipped[i]
                  ? "bg-brand-soft font-medium text-brand-text"
                  : "text-text-muted hover:bg-surface-muted hover:text-text"
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
      <div className="flex flex-wrap items-center gap-2 sm:pl-[1.75rem]">
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

/** The tallest an answer grows to, in px (max-h-32); past it the text scrolls. */
const ANSWER_MAX = 128;

/**
 * One answer: a line tall, growing with what is written in it (the stylesheet
 * does it; where it cannot, the field is measured as the message field is).
 */
function AnswerField({ value, ...rest }: Omit<ComponentProps<"textarea">, "value"> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useGrowingField(ref, ANSWER_MAX, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      {...rest}
      className="input-field scroll-thin field-sizing-content col-start-2 max-h-32 min-h-[2.125rem] min-w-0 resize-none overflow-y-auto px-2.5 py-1.5 text-[0.8125rem] leading-5 disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}
