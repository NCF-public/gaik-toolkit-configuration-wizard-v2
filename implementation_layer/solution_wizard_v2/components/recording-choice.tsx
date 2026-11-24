"use client";

export type RecordingChoiceLabels = {
  title: string;
  body: string;
  allow: string;
  decline: string;
  /** The answer could not be given: said under the buttons, to try again. */
  failed: string;
  /** In the message field while the question waits. */
  waiting: string;
  /** The session already had the other answer: which one stands. */
  inForceStored: string;
  inForceNotStored: string;
};

/**
 * Asks whether the session's usage data may be stored for monitoring. It sits
 * in the chat, above the message field, like an approval the conversation
 * waits for: the wizard does not answer, and no message goes out, before one
 * of the two is pressed. Storing is shown as the usual answer; nothing is
 * chosen until a button is pressed.
 */
export function RecordingChoice({
  labels,
  busy,
  failed,
  onAnswer,
}: {
  labels: RecordingChoiceLabels;
  /** The answer is on its way. */
  busy: boolean;
  failed: boolean;
  onAnswer: (answer: "stored" | "not_stored") => void;
}) {
  return (
    <div
      role="group"
      data-testid="recording-choice"
      aria-labelledby="recording-choice-title"
      aria-describedby="recording-choice-body"
      className="mb-2 rounded-xl border border-border-strong bg-surface px-4 py-3"
    >
      <p id="recording-choice-body" className="text-sm leading-relaxed text-text-secondary">
        {labels.body}
      </p>
      <p id="recording-choice-title" className="mt-2 text-sm font-semibold text-text-strong">
        {labels.title}
      </p>
      {/* The usual answer is on the right and filled; the other is as easy to press. */}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          data-testid="recording-decline"
          disabled={busy}
          onClick={() => onAnswer("not_stored")}
          className="btn-secondary"
        >
          {labels.decline}
        </button>
        <button
          type="button"
          data-testid="recording-allow"
          disabled={busy}
          onClick={() => onAnswer("stored")}
          className="btn-brand"
        >
          {labels.allow}
        </button>
      </div>
      {failed && (
        <p role="alert" data-testid="recording-failed" className="mt-2 text-sm text-danger-text">
          {labels.failed}
        </p>
      )}
    </div>
  );
}
