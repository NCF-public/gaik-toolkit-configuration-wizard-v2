"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { approve, reject } from "@/app/(app)/sessions/[id]/actions";
import {
  askInChat,
  CHAT_REPLYING_EVENT,
  CHAT_SEND_DELIVERED_EVENT,
  CHAT_SEND_EVENT,
  CHAT_SEND_FAILED_EVENT,
} from "@/lib/chat-events";
import { GATE_MOVED_NOTICE, withoutStepParams, type RejectOutcome } from "@/lib/step-redirect";
import { REJECT_REASON_MAX, gateReference, rejectMessage } from "@/lib/gate-guide";
import { PendingSubmitButton } from "./pending-submit-button";
import { Icon } from "./icons";

export type GateDecisionLabels = {
  /** The gate's own approve label ("Hyväksy ratkaisun rakenne ja jatka"). */
  approve: string;
  /** What the approve button shows where the full label does not fit ("Hyväksy"). */
  approveShort: string;
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
  /** The gate could not be marked rejected (signed out, the server failed, the session moved on). */
  rejectNotSaved: string;
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
 * Until the agent has started on that turn the reason is kept in this tab
 * (sessionStorage), so a failed send or a reload leaves it here to send again
 * instead of a rejected gate with no reason.
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
  const [notSaved, setNotSaved] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  // The rejection message last handed to the chat, to offer it again if it
  // never reached the agent.
  const lastSent = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const formId = useId();
  const noteId = useId();
  // The wizard's reply at a gate ends with "approve it in the panel". The
  // approve button draws the eye once as the bar appears, and again each time
  // the wizard finishes a reply while the session waits here.
  const [nudge, setNudge] = useState(1);
  useEffect(() => {
    let replying = false;
    const onReplying = (e: Event) => {
      const now = Boolean((e as CustomEvent<boolean>).detail);
      if (replying && !now) setNudge((n) => n + 1);
      replying = now;
    };
    window.addEventListener(CHAT_REPLYING_EVENT, onReplying);
    return () => window.removeEventListener(CHAT_REPLYING_EVENT, onReplying);
  }, []);

  // The reason of this gate's rejection while it has not reached the agent.
  const reasonKey = `gaik-wizard:reject-reason:${sessionId}:${gateStep}`;
  const keepReason = (message: string | null) => {
    try {
      if (message) window.sessionStorage.setItem(reasonKey, message);
      else window.sessionStorage.removeItem(reasonKey);
    } catch {
      // Storage blocked: the reason is offered again only until a reload.
    }
  };

  useEffect(() => {
    const isLast = (e: Event) => lastSent.current !== null && (e as CustomEvent<string>).detail === lastSent.current;
    const onFailed = (e: Event) => {
      if (isLast(e)) setFailed(true);
    };
    const onDelivered = (e: Event) => {
      if (isLast(e)) keepReason(null);
    };
    window.addEventListener(CHAT_SEND_FAILED_EVENT, onFailed);
    window.addEventListener(CHAT_SEND_DELIVERED_EVENT, onDelivered);
    return () => {
      window.removeEventListener(CHAT_SEND_FAILED_EVENT, onFailed);
      window.removeEventListener(CHAT_SEND_DELIVERED_EVENT, onDelivered);
    };
    // keepReason reads only the key, which is fixed for a bar (one per gate).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A page loaded on a rejected gate whose reason never went out (the send
  // failed, or the page was reloaded first) offers the reason again.
  useEffect(() => {
    let kept: string | null = null;
    try {
      kept = window.sessionStorage.getItem(reasonKey);
    } catch {
      // Storage blocked: nothing was kept.
    }
    if (!kept) return;
    if (!rejected) {
      keepReason(null);
      return;
    }
    if (lastSent.current) return; // on its way from this bar
    lastSent.current = kept;
    setFailed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rejected, reasonKey]);

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
    let outcome: RejectOutcome = "failed";
    try {
      outcome = await reject(formData);
    } catch {
      outcome = "failed";
    }
    if (outcome === "moved") {
      // The session is no longer waiting at this gate: nothing was rejected,
      // and the page (now showing where the session stands) says so.
      router.replace(withoutStepParams(pathname, window.location.search, GATE_MOVED_NOTICE));
      return;
    }
    if (outcome !== "saved") {
      // The form stays open with the reason in it.
      setNotSaved(true);
      return;
    }
    setNotSaved(false);
    const message = rejectMessage(labels.rejectMessage, gate, topic, text);
    keepReason(message);
    send(message);
    setReason("");
    setRejectOpen(false);
    toggleRef.current?.focus();
    // A notice from an earlier refused approval no longer applies.
    if (hadNotice) router.replace(withoutStepParams(pathname, window.location.search));
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
          <input type="hidden" name="step" value={gateStep} />
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
          {notSaved && (
            <p role="alert" className="text-xs text-danger-text">
              {labels.rejectNotSaved}
            </p>
          )}
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
      {rejected && !failed && (
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

      {/* One row at every width, in reading order: back (Gate 1), reject,
          ask for changes, approve. On a phone the row keeps to what fits:
          reject and back are icons and approve reads "Hyväksy" (its full
          label stays its name). The note is the approve button's
          description and its hover hint; it is written out only where the
          row has room for it on the left. Under the row it cost a line of
          the workspace's height at every usual width. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 @xl:gap-x-2">
        {leading && <div className="@xl:mr-1 @5xl:order-1">{leading}</div>}
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={rejectOpen}
          aria-controls={rejectOpen ? formId : undefined}
          title={labels.reject}
          onClick={() => setRejectOpen((o) => !o)}
          className="inline-flex h-[38px] items-center justify-center rounded-md px-2.5 text-sm font-medium text-text-muted transition-colors hover:text-danger-text @max-xl:w-[38px] @max-xl:hover:bg-surface-muted @xl:ml-auto @5xl:order-3 @5xl:ml-0"
        >
          <Icon name="x" size={16} className="@xl:hidden" />
          <span className="@max-xl:sr-only">{labels.reject}</span>
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
          className="btn-secondary @max-xl:px-3 @5xl:order-4"
        >
          <Icon name="messageSquareText" size={16} className="@max-xl:hidden" />
          {labels.requestChanges}
        </button>
        <form
          // Keyed so the highlight plays again on the next nudge.
          key={nudge}
          action={approve}
          title={labels.note}
          className={`min-w-0 flex-1 rounded-md @xl:flex-none @5xl:order-5 ${blocked ? "" : "gate-nudge"}`}
        >
          <input type="hidden" name="id" value={sessionId} />
          <input type="hidden" name="step" value={gateStep} />
          {hadNotice && <input type="hidden" name="notice" value="1" />}
          <PendingSubmitButton
            label={
              <>
                <span className="@xl:hidden" aria-hidden>
                  {labels.approveShort}
                </span>
                <span className="@max-xl:sr-only">{labels.approve}</span>
              </>
            }
            pendingLabel={
              <>
                <span className="@xl:hidden" aria-hidden>
                  {labels.approveShort}
                </span>
                <span className="@max-xl:sr-only">{labels.approving}</span>
              </>
            }
            disabled={blocked}
            icon="check"
            describedBy={noteId}
            className="btn-brand w-full whitespace-nowrap font-semibold"
          />
        </form>
        {/* On a phone the line under the phase title says what to do; the
            note stays the approve button's description. */}
        <p
          id={noteId}
          className="sr-only text-xs text-text-muted @5xl:not-sr-only @5xl:order-2 @5xl:basis-0 @5xl:flex-1 @5xl:text-left"
        >
          {labels.note}
        </p>
      </div>
    </div>
  );
}
