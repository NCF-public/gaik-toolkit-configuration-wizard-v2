"use client";

import { useActionState, useRef, useState } from "react";
import { removeSession, type RemoveSessionState } from "@/app/actions";

type Labels = {
  open: string;
  title: string;
  body: string;
  confirmLabel: string;
  confirm: string;
  cancel: string;
  mismatch: string;
  busy: string;
  protected: string;
  failed: string;
};

const INITIAL: RemoveSessionState = { error: null };

export function DeleteSessionButton({
  sessionId,
  title,
  labels,
}: {
  sessionId: string;
  title: string;
  labels: Labels;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [state, action, pending] = useActionState(removeSession, INITIAL);
  const error = state.error ? labels[state.error] : null;
  const close = () => {
    setTyped("");
    dialog.current?.close();
  };

  return (
    <>
      <button
        type="button"
        data-testid="delete-session-open"
        aria-label={`${labels.open}: ${title}`}
        onClick={() => dialog.current?.showModal()}
        className="shrink-0 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-muted transition-colors hover:border-danger-border hover:text-danger-text"
      >
        {labels.open}
      </button>
      <dialog
        ref={dialog}
        onClose={() => setTyped("")}
        aria-labelledby={`delete-title-${sessionId}`}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-5 text-text shadow-lg backdrop:bg-black/40"
      >
        <form action={action} className="space-y-3">
          <h2
            id={`delete-title-${sessionId}`}
            className="text-base font-semibold text-text-strong"
          >
            {labels.title}
          </h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            {labels.body}
          </p>
          <p className="break-words text-sm font-semibold text-text-strong">
            {title}
          </p>
          <input type="hidden" name="sessionId" value={sessionId} />
          <label className="block text-sm text-text-secondary">
            {labels.confirmLabel}
            <input
              name="confirmation"
              data-testid="delete-session-confirmation"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="input-field mt-1 w-full"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="btn-secondary">
              {labels.cancel}
            </button>
            <button
              type="submit"
              data-testid="delete-session-confirm"
              disabled={pending || typed.trim() !== title.trim()}
              className="rounded-lg bg-danger-text px-3 py-2 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            >
              {labels.confirm}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
