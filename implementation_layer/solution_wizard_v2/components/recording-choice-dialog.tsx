"use client";

import { useEffect, useRef } from "react";
import type { SessionRecording } from "@/lib/wizard-api-client";

export type RecordingChoiceLabels = {
  title: string;
  body: string;
  allow: string;
  decline: string;
};

/**
 * Asks, as a session starts, whether its usage data may be stored for
 * monitoring. It opens as it mounts and has no default: the session is created
 * with the answer, and closing it without one (Esc) starts nothing.
 */
export function RecordingChoiceDialog({
  labels,
  onAnswer,
  onClose,
}: {
  labels: RecordingChoiceLabels;
  onAnswer: (answer: SessionRecording) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const answered = useRef(false);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  function answer(value: SessionRecording) {
    answered.current = true;
    dialog.current?.close();
    onAnswer(value);
  }

  return (
    <dialog
      ref={dialog}
      data-testid="recording-choice"
      onClose={() => {
        if (!answered.current) onClose();
      }}
      aria-labelledby="recording-choice-title"
      aria-describedby="recording-choice-body"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-5 text-text shadow-lg backdrop:bg-black/40"
    >
      <div className="space-y-3">
        <h2 id="recording-choice-title" className="text-base font-semibold text-text-strong">
          {labels.title}
        </h2>
        <p id="recording-choice-body" className="text-sm leading-relaxed text-text-secondary">
          {labels.body}
        </p>
        {/* Two equal buttons: neither answer is the suggested one. */}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            data-testid="recording-decline"
            onClick={() => answer("not_stored")}
            className="btn-secondary"
          >
            {labels.decline}
          </button>
          <button
            type="button"
            data-testid="recording-allow"
            onClick={() => answer("stored")}
            className="btn-secondary"
          >
            {labels.allow}
          </button>
        </div>
      </div>
    </dialog>
  );
}
