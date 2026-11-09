"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type { ChatMessage } from "@/lib/mock-sessions";
import { ChatPanel } from "./chat-panel";
import { Icon } from "./icons";
import type { ChatActivityLabels } from "@/lib/chat-activity";
import type { ChatErrorLabels } from "@/lib/chat-limits";
import { CHAT_SEND_EVENT, type QueuedMessage } from "@/lib/chat-events";
import type { ChatQuestionLabels } from "./chat-questions";

/** The width a viewer last dragged the chat to; a per-browser convenience. */
const WIDTH_KEY = "gaik-wizard.chat-width";
const DEFAULT_WIDTH = 400;
/** While the chat is the focus (requirements gathering) it starts wider. */
const WIDE_WIDTH = 480;
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
/** The workspace keeps at least this much when the chat is dragged wider. */
const MIN_WORKSPACE = 440;
const KEY_STEP = 24;

/** Opens the chat from elsewhere on the page (the "start" button of the first step). */
export const OPEN_CHAT_EVENT = "gaik-wizard:open-chat";

export function ChatDock({
  sessionId,
  initialMessages,
  chatTitle,
  greeting,
  aiNotice,
  assistantLabel,
  inputPlaceholder,
  inputLabel,
  sendLabel,
  streamFailedLabel,
  thinkingLabel,
  hideChatLabel,
  showChatLabel,
  resizeLabel,
  defaultOpen = true,
  wide = false,
  autoSend,
  busyLabel,
  activityLabels,
  errorLabels,
  questionLabels,
}: {
  sessionId: string;
  initialMessages: ChatMessage[];
  chatTitle: string;
  greeting: string;
  aiNotice: string;
  assistantLabel: string;
  inputPlaceholder: string;
  inputLabel: string;
  sendLabel: string;
  streamFailedLabel: string;
  thinkingLabel: string;
  hideChatLabel: string;
  showChatLabel: string;
  /** Accessible name of the drag handle between the workspace and the chat. */
  resizeLabel: string;
  /** false on BPMN+ workspace steps so the canvas gets the viewport (GAIK review). */
  defaultOpen?: boolean;
  /** wider panel while the chat is the focus (gathering / Q&A). */
  wide?: boolean;
  /** A message the panel sends on its own once (a gate approved in the panel, #173). */
  autoSend?: string;
  /** Shown when the wizard is still answering the previous message. */
  busyLabel: string;
  activityLabels?: ChatActivityLabels;
  errorLabels?: ChatErrorLabels;
  /** Labels for answering a round of questions one by one. */
  questionLabels?: ChatQuestionLabels;
}) {
  // The step decides whether the dock opens, once. A chat turn can move the
  // step (the page re-renders after every turn), and following the new default
  // then collapsed the dock under the message just sent: the input vanished
  // mid-conversation. The page keys this dock by session, so another session
  // still opens with its own default. The width does follow the step (wider
  // while gathering requirements) until the viewer sets one.
  const [open, setOpen] = useState(defaultOpen);
  const [width, setWidth] = useState(wide ? WIDE_WIDTH : DEFAULT_WIDTH);
  // The width the viewer chose, or the step's default until they do; a
  // narrower window clamps what is shown, and a wider one gives it back.
  const preferredWidth = useRef(width);
  const userWidth = useRef(false);
  // The widest the separator can go in this window, for assistive tech.
  const [maxWidth, setMaxWidth] = useState(MAX_WIDTH);
  const [dragging, setDragging] = useState(false);
  // Bumped to move focus into the message field (the first step's start button).
  const [focusSignal, setFocusSignal] = useState(0);
  // Messages handed over by CHAT_SEND_EVENT, in order, until the panel takes
  // them. Kept here because the panel unmounts when the dock collapses; a
  // message the panel has taken is gone from here, so reopening the chat does
  // not send it again.
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const queuedCount = useRef(0);
  // While gathering requirements the chat is where the session happens, so it
  // stays open on a narrow screen too, and an empty one takes the cursor.
  const startsInChat = useRef(wide);
  const startsEmpty = useRef(initialMessages.length === 0);
  // Kept here (not in ChatPanel) so a half-typed message survives hide/show —
  // ChatPanel unmounts when the dock collapses to the rail.
  const [chatInput, setChatInput] = useState("");
  const panelId = useId();
  const asideRef = useRef<HTMLElement>(null);
  // Focus follows the panel: opening puts it in the message field, closing
  // puts it back on the rail's open button (the header button it was on is
  // gone with the panel).
  const railToggleRef = useRef<HTMLButtonElement>(null);
  const focusRailOnClose = useRef(false);
  useEffect(() => {
    if (open || !focusRailOnClose.current) return;
    focusRailOnClose.current = false;
    railToggleRef.current?.focus();
  }, [open]);
  // Below 1280 px the open chat lies over the workspace: Esc closes it and
  // puts focus back on the button that opened it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (!window.matchMedia("(max-width: 1279px)").matches) return;
      // An Esc meant for a dialog or the BPMN editor is theirs, not the chat's.
      const target = e.target;
      if (!(target instanceof Node) || !asideRef.current?.contains(target)) return;
      setOpen(false);
      document.querySelector<HTMLElement>("[data-open-chat]")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  // The running drag's cleanup, so leaving the page mid-drag still restores
  // text selection and drops the listeners.
  const endDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endDragRef.current?.(), []);

  // Widest the chat may go without squeezing the workspace below its minimum.
  const clamp = useCallback((w: number) => {
    const aside = asideRef.current;
    const main = aside?.previousElementSibling as HTMLElement | null;
    const roomy = aside && main ? aside.offsetWidth + main.offsetWidth - MIN_WORKSPACE : MAX_WIDTH;
    const max = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, roomy));
    return Math.round(Math.min(Math.max(w, MIN_WIDTH), max));
  }, []);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(WIDTH_KEY));
      if (saved > 0) {
        preferredWidth.current = saved;
        userWidth.current = true;
        setWidth(clamp(saved));
      }
    } catch {
      // Storage blocked: the default width stands.
    }
    // Below 1280 px a docked chat squeezed the workspace to a third of the
    // screen; there it opens over the workspace instead, so it starts closed
    // and opens from its button.
    if (window.matchMedia("(max-width: 1279px)").matches) {
      if (!startsInChat.current) setOpen(false);
    }
    else setMaxWidth(clamp(MAX_WIDTH));
    // Below 1280 px the dock is an overlay or hidden, so there is nothing to
    // measure against; the docked width is worked out again above it.
    const onResize = () => {
      if (window.innerWidth < 1280) return;
      setWidth(clamp(preferredWidth.current));
      setMaxWidth(clamp(MAX_WIDTH));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  // Until the viewer sets a width, the dock takes the step's default: wide while
  // gathering requirements, narrower once the blueprint, BPMN and PoC take over.
  useEffect(() => {
    if (userWidth.current) return;
    const w = wide ? WIDE_WIDTH : DEFAULT_WIDTH;
    preferredWidth.current = w;
    setWidth(clamp(w));
  }, [wide, clamp]);

  // A new session starts in the chat: its field takes the cursor, except on
  // a touch screen, where that would raise the keyboard over the page.
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    if (defaultOpen && startsInChat.current && startsEmpty.current && fine) {
      setFocusSignal((n) => n + 1);
    }
    // Once, on the page's first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The panel only exists while the dock is open; a message to send needs it.
  useEffect(() => {
    if (autoSend) setOpen(true);
  }, [autoSend]);

  useEffect(() => {
    const openChat = () => {
      setOpen(true);
      setFocusSignal((n) => n + 1);
    };
    const sendFromPage = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text !== "string" || !text.trim()) return;
      setOpen(true);
      queuedCount.current += 1;
      const queuedId = queuedCount.current;
      setQueue((q) => [...q, { id: queuedId, text }]);
    };
    window.addEventListener(OPEN_CHAT_EVENT, openChat);
    window.addEventListener(CHAT_SEND_EVENT, sendFromPage);
    return () => {
      window.removeEventListener(OPEN_CHAT_EVENT, openChat);
      window.removeEventListener(CHAT_SEND_EVENT, sendFromPage);
    };
  }, []);

  const saveWidth = (w: number) => {
    preferredWidth.current = w;
    userWidth.current = true;
    try {
      window.localStorage.setItem(WIDTH_KEY, String(w));
    } catch {
      // Not remembered; nothing else depends on it.
    }
  };

  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const startX = e.clientX;
    const startWidth = width;
    let last = startWidth;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    const previousSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const move = (ev: PointerEvent) => {
      last = clamp(startWidth + (startX - ev.clientX));
      setWidth(last);
    };
    const end = () => {
      if (endDragRef.current !== end) return;
      endDragRef.current = null;
      setDragging(false);
      document.body.style.userSelect = previousSelect;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.removeEventListener("lostpointercapture", end);
      saveWidth(last);
    };
    endDragRef.current = end;
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("lostpointercapture", end);
  }

  function onHandleKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const next =
      e.key === "ArrowLeft"
        ? width + KEY_STEP
        : e.key === "ArrowRight"
          ? width - KEY_STEP
          : e.key === "Home"
            ? MIN_WIDTH
            : e.key === "End"
              ? MAX_WIDTH
              : null;
    if (next === null) return;
    e.preventDefault();
    const w = clamp(next);
    setWidth(w);
    saveWidth(w);
  }

  // A double-click gives the width back to the step: its default now, and the
  // next step's default after it.
  function resetWidth() {
    const w = wide ? WIDE_WIDTH : DEFAULT_WIDTH;
    preferredWidth.current = w;
    userWidth.current = false;
    setWidth(clamp(w));
    try {
      window.localStorage.removeItem(WIDTH_KEY);
    } catch {
      // Nothing was remembered.
    }
  }

  return (
    <>
      <aside
        ref={asideRef}
        role="complementary"
        aria-label={chatTitle}
        data-testid="chat-dock"
        data-chat-open={open ? "true" : "false"}
        style={{ "--chat-w": `${width}px` } as CSSProperties}
        className={`chat-bg relative flex min-h-0 shrink-0 flex-col border-l border-border ${
          open
            ? "max-xl:fixed max-xl:z-30 max-xl:shadow-lg xl:w-[var(--chat-w)] md:max-xl:bottom-0 md:max-xl:right-0 md:max-xl:top-14 md:max-xl:w-[26rem] max-md:sheet-in max-md:inset-x-0 max-md:bottom-0 max-md:h-[60dvh] max-md:rounded-t-2xl max-md:border-l-0 max-md:border-t"
            : "w-11 max-xl:hidden"
        } ${dragging ? "" : "transition-[width] duration-200 ease-out motion-reduce:transition-none"}`}
      >
        {open && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={resizeLabel}
            aria-controls={panelId}
            aria-valuemin={MIN_WIDTH}
            aria-valuemax={maxWidth}
            aria-valuenow={width}
            tabIndex={0}
            title={resizeLabel}
            onPointerDown={startDrag}
            onKeyDown={onHandleKey}
            onDoubleClick={resetWidth}
            data-testid="chat-resize"
            className="group absolute inset-y-0 -left-1.5 z-10 hidden w-3 cursor-col-resize touch-none outline-none xl:block"
          >
            <span
              className={`absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors ${
                dragging ? "bg-brand" : "bg-transparent group-hover:bg-brand/60 group-focus-visible:bg-brand"
              }`}
            />
          </div>
        )}

        {open ? (
          <ChatPanel
            id={panelId}
            sessionId={sessionId}
            initialMessages={initialMessages}
            chatTitle={chatTitle}
            greeting={greeting}
            aiNotice={aiNotice}
            assistantLabel={assistantLabel}
            inputPlaceholder={inputPlaceholder}
            inputLabel={inputLabel}
            sendLabel={sendLabel}
            streamFailedLabel={streamFailedLabel}
            thinkingLabel={thinkingLabel}
            inputValue={chatInput}
            onInputChange={setChatInput}
            autoSend={autoSend}
            busyLabel={busyLabel}
            errorLabels={errorLabels}
            questionLabels={questionLabels}
            activityLabels={activityLabels}
            hideChatLabel={hideChatLabel}
            onCollapse={() => {
              focusRailOnClose.current = true;
              setOpen(false);
            }}
            focusSignal={focusSignal}
            queue={queue}
            onQueuedTaken={(id) => setQueue((q) => q.filter((m) => m.id !== id))}
          />
        ) : (
          <div className="flex h-full flex-col items-center gap-2 py-2.5">
            <button
              ref={railToggleRef}
              type="button"
              data-testid="chat-dock-toggle"
              onClick={() => {
                setOpen(true);
                setFocusSignal((n) => n + 1);
              }}
              aria-expanded={false}
              aria-controls={panelId}
              aria-label={showChatLabel}
              title={showChatLabel}
              className="icon-btn"
            >
              <Icon name="panelRightOpen" size={18} />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={() => setOpen(true)}
              className="rounded-md px-1 py-2 text-xs font-medium text-text-muted [writing-mode:vertical-rl] hover:text-text"
            >
              {chatTitle}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

/**
 * Opens the chat and puts the cursor in the message field. Below the desktop
 * layout this is how the closed chat is reached; the first step uses it as its
 * start button.
 */
export function OpenChatButton({
  label,
  className,
  icon = true,
}: {
  label: string;
  className: string;
  icon?: boolean;
}) {
  return (
    <button
      type="button"
      data-open-chat
      onClick={() => window.dispatchEvent(new Event(OPEN_CHAT_EVENT))}
      className={className}
    >
      {icon && <Icon name="messageSquare" size={16} />}
      {label}
    </button>
  );
}
