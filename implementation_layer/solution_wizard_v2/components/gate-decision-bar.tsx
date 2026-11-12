"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { approve } from "@/app/(app)/sessions/[id]/actions";
import { askInChat, CHAT_REPLYING_EVENT, GATE_BAR_ATTRIBUTE, GATE_POINT_EVENT } from "@/lib/chat-events";
import { gateReference } from "@/lib/gate-guide";
import { PendingSubmitButton } from "./pending-submit-button";
import { Icon } from "./icons";

/** How long the approve button stays marked after "Show me" in the chat. */
const POINTED_MS = 1500;

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
  /** Said above the buttons while the gate stands rejected. */
  rejected: string;
};

/**
 * The decision at a gate, kept in view under what it decides: ask for changes
 * in the chat, or approve.
 *
 * Approval is the server action it always was (agent_busy, gate_not_ready and
 * the wake turn stay as they are). A change request opens the chat with the
 * gate as a reference, so it becomes a real turn the agent acts on. The bar
 * has no reject button: a rejection said nothing a change request does not. A
 * gate that already stands rejected (an older session, or the API) is still
 * shown as such, and the same two buttons are its way on.
 */
export function GateDecisionBar({
  sessionId,
  gate,
  gateStep,
  rejected = false,
  blocked = false,
  missing,
  hadNotice = false,
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
  /** Why it is blocked and the fields that unblock it, shown above the buttons. */
  missing?: ReactNode;
  /** The page shows a notice from a refused action; the next action clears it. */
  hadNotice?: boolean;
  labels: GateDecisionLabels;
}) {
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

  // "Show me" in the chat (GATE_POINT_EVENT): the bar comes into view, the
  // approve button takes the focus and wears a ring for a moment. With reduced
  // motion there is no ring and no smooth scroll, only the place and the focus.
  const rootRef = useRef<HTMLDivElement>(null);
  const [pointed, setPointed] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onPoint = () => {
      const root = rootRef.current;
      if (!root) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      root.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
      root.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus({ preventScroll: true });
      setPointed(true);
      clearTimeout(timer);
      timer = setTimeout(() => setPointed(false), POINTED_MS);
    };
    window.addEventListener(GATE_POINT_EVENT, onPoint);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(GATE_POINT_EVENT, onPoint);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      {...{ [GATE_BAR_ATTRIBUTE]: "" }}
      data-testid={`gate${gate}-actions`}
      className="@container relative z-10 shrink-0 border-t border-border bg-surface px-4 py-3 sm:px-6"
    >
      {missing}
      {rejected && (
        <p role="status" className="mb-2.5 flex items-start gap-2 text-sm text-danger-text">
          <Icon name="circleAlert" size={16} className="mt-0.5" />
          <span>{labels.rejected}</span>
        </p>
      )}

      {/* One row at every width, in reading order: ask for changes, approve.
          On a phone approve reads "Hyväksy" (its full label stays its name).
          The note is the approve button's description and its hover hint; it
          is written out only where the row has room for it on the left. Under
          the row it cost a line of the workspace's height at every usual
          width. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 @xl:gap-x-2">
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
          className="btn-secondary @max-xl:px-3 @xl:ml-auto @5xl:order-2 @5xl:ml-0"
        >
          <Icon name="messageSquareText" size={16} className="@max-xl:hidden" />
          {labels.requestChanges}
        </button>
        <form
          // Keyed so the highlight plays again on the next nudge.
          key={nudge}
          action={approve}
          title={labels.note}
          data-pointed={pointed ? "" : undefined}
          className={`gate-point min-w-0 flex-1 rounded-md @xl:flex-none @5xl:order-3 ${blocked ? "" : "gate-nudge"}`}
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
          className="sr-only text-xs text-text-muted @5xl:not-sr-only @5xl:order-1 @5xl:basis-0 @5xl:flex-1 @5xl:text-left"
        >
          {labels.note}
        </p>
      </div>
    </div>
  );
}
