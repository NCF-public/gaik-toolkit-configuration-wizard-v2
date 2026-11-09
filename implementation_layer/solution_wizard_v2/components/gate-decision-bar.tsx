"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { approve, reject } from "@/app/sessions/[id]/actions";
import { askInChat, CHAT_SEND_EVENT, CHAT_SEND_FAILED_EVENT } from "@/lib/chat-events";
import { REJECT_REASON_MAX, gateReference, rejectMessage } from "@/lib/gate-guide";
import { PendingSubmitButton } from "./pending-submit-button";
import { Icon } from "./icons";

export type GateDecisionLabels = {
  /** The gate's own approve label ("Hyväksy ratkaisun rakenne ja jatka"). */
  approve: string;
  approving: string;
  /** One line on what approving leads to. */
  note: string;
  requestChanges: string;
  /** Each gate's business topic, Gate 1–4, for the chat reference. */
  topics: string[];
  chip: string;
  requestPrefix: string;
  reject: string;
  rejectReason: string;
  rejectPlaceholder: string;
  rejectHow: string;
  rejectSubmit: string;
  rejectCancel: string;
  rejectMessage: string;
  rejected: string;
  rejectFailed: string;
  rejectResend: string;
};

/**
 * The decision at a gate, kept in view under what it decides: approve, ask for
 * changes in the chat, or (less often) reject with a reason.
 *
 * Approval is the server action it always was (agent_busy, gate_not_ready and
 * the wake turn stay as they are). A change request opens the chat with the
 * gate as a reference, so it becomes a real turn the agent acts on; the old
 * form only appended to a stored transcript the live agent never reads. A
 * rejection marks the gate rejected and then sends its reason as a chat turn.
 */
export function GateDecisionBar({
  sessionId,
  gate,
  gateStep,
  rejected = false,
  blocked = false,
  warning,
  hadNotice = false,
  leading,
  labels,
}: {
  sessionId: string;
  /** Gate 1–4. */
  gate: number;
  gateStep: number;
  /** The gate stands rejected: say so above the buttons. */
  rejected?: boolean;
  /** Approval is not possible yet (Gate 1 without the business context). */
  blocked?: boolean;
  /** Why it is blocked, shown above the buttons. */
  warning?: ReactNode;
  /** The page shows a notice from a refused action; the next action clears it. */
  hadNotice?: boolean;
  /** A control on the bar's left (Gate 1's "Previous"). */
  leading?: ReactNode;
  labels: GateDecisionLabels;
}) {
  const topic = labels.topics[gate - 1] ?? "";
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState(false);
  // The rejection message last handed to the chat, to offer it again if it
  // never reached the agent.
  const lastSent = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const formId = useId();
  const noteId = useId();

  useEffect(() => {
    const onFailed = (e: Event) => {
      if (lastSent.current && (e as CustomEvent<string>).detail === lastSent.current) setFailed(true);
    };
    window.addEventListener(CHAT_SEND_FAILED_EVENT, onFailed);
    return () => window.removeEventListener(CHAT_SEND_FAILED_EVENT, onFailed);
  }, []);

  // The reject form closes on Escape or a press outside the bar, and gives the
  // focus back to the button that opened it.
  useEffect(() => {
    if (!rejectOpen) return;
    fieldRef.current?.focus();
    const close = () => {
      setRejectOpen(false);
      toggleRef.current?.focus();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setRejectOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [rejectOpen]);

  function send(message: string) {
    lastSent.current = message;
    setFailed(false);
    window.dispatchEvent(new CustomEvent(CHAT_SEND_EVENT, { detail: message }));
  }

  async function submitReject(formData: FormData) {
    const text = reason.trim();
    if (!text) return;
    if (!(await reject(formData))) return;
    send(rejectMessage(labels.rejectMessage, gate, topic, text));
    setReason("");
    setRejectOpen(false);
  }

  return (
    <div
      ref={rootRef}
      data-testid={`gate${gate}-actions`}
      className="@container relative z-10 shrink-0 border-t border-border bg-surface px-4 py-3 sm:px-6"
    >
      {rejectOpen && (
        <form
          id={formId}
          action={submitReject}
          data-testid="gate-reject-form"
          className="absolute inset-x-4 bottom-full mb-2 space-y-2 rounded-lg border border-border bg-surface p-3 shadow-lg transition-[opacity,translate] duration-150 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none sm:left-auto sm:right-6 sm:w-96"
        >
          <input type="hidden" name="id" value={sessionId} />
          <label htmlFor={`${formId}-reason`} className="block text-xs font-semibold text-text">
            {labels.rejectReason}
          </label>
          <textarea
            ref={fieldRef}
            id={`${formId}-reason`}
            name="feedback"
            required
            maxLength={REJECT_REASON_MAX}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={labels.rejectPlaceholder}
            className="input-field resize-y"
          />
          <p className="text-xs text-text-muted">{labels.rejectHow}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setRejectOpen(false);
                toggleRef.current?.focus();
              }}
              className="btn-ghost px-3 py-1.5"
            >
              {labels.rejectCancel}
            </button>
            <PendingSubmitButton
              label={labels.rejectSubmit}
              pendingLabel={labels.rejectSubmit}
              className="btn-secondary px-3 py-1.5 text-danger-text hover:text-danger-text"
            />
          </div>
        </form>
      )}

      {warning && (
        <div
          role="status"
          className="mb-2.5 flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text"
        >
          <Icon name="circleAlert" size={16} className="mt-0.5" />
          <span>{warning}</span>
        </div>
      )}
      {rejected && (
        <p role="status" className="mb-2.5 flex items-start gap-2 text-sm text-danger-text">
          <Icon name="circleAlert" size={16} className="mt-0.5" />
          <span>{labels.rejected}</span>
        </p>
      )}
      {failed && (
        <p role="alert" className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-danger-text">
          <Icon name="circleAlert" size={16} />
          <span>{labels.rejectFailed}</span>
          <button
            type="button"
            onClick={() => lastSent.current && send(lastSent.current)}
            className="font-medium underline underline-offset-2"
          >
            {labels.rejectResend}
          </button>
        </p>
      )}

      {/* Phone: approve on a row of its own, the other actions under it.
          Wider: one row of actions with approve last, the note under them;
          wide enough, the note moves into that row on the left. */}
      <div className="flex flex-col gap-2 @xl:flex-row @xl:flex-wrap @xl:items-center @xl:gap-x-2 @xl:gap-y-1">
        <form action={approve} className="order-1 @xl:order-5">
          <input type="hidden" name="id" value={sessionId} />
          {hadNotice && <input type="hidden" name="notice" value="1" />}
          <PendingSubmitButton
            label={labels.approve}
            pendingLabel={labels.approving}
            disabled={blocked}
            icon="check"
            describedBy={noteId}
            className="btn-gold w-full disabled:cursor-not-allowed disabled:opacity-50 @xl:w-auto"
          />
        </form>
        <div className="order-2 flex items-center gap-1 @xl:contents">
          {leading && <div className="@xl:order-1 @xl:mr-1">{leading}</div>}
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={rejectOpen}
            aria-controls={rejectOpen ? formId : undefined}
            onClick={() => setRejectOpen((o) => !o)}
            className="ml-auto rounded-md px-2.5 py-2 text-sm font-medium text-text-muted transition-colors hover:text-danger-text @xl:order-3"
          >
            {labels.reject}
          </button>
          <button
            type="button"
            onClick={() =>
              askInChat(
                gateReference(
                  { topics: labels.topics, chip: labels.chip, prefix: labels.requestPrefix },
                  gate,
                  gateStep,
                ),
              )
            }
            className="btn-secondary @xl:order-4"
          >
            <Icon name="messageSquareText" size={16} />
            {labels.requestChanges}
          </button>
        </div>
        {/* On a phone the line under the phase title says what to do; the
            note stays the approve button's description. */}
        <p
          id={noteId}
          className="sr-only text-xs text-text-muted @xl:not-sr-only @xl:order-6 @xl:basis-full @xl:text-right @5xl:order-2 @5xl:basis-0 @5xl:flex-1 @5xl:text-left"
        >
          {labels.note}
        </p>
      </div>
    </div>
  );
}
