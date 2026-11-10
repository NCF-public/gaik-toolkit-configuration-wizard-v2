"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatMessage, ChatRole } from "@/lib/mock-sessions";
import {
  activityText,
  parseActivity,
  type ChatActivityLabels,
  type ChatPanelLabels,
} from "@/lib/chat-activity";
import { MAX_CHAT_MESSAGE_CHARS, chatRefusalLabel, type ChatErrorLabels } from "@/lib/chat-limits";
import { CHAT_SEND_FAILED_EVENT, type ChatReference, type QueuedMessage } from "@/lib/chat-events";
import { approvedGateIn, referenceMessage } from "@/lib/chat-reference";
import {
  BACKGROUNDS,
  BACKGROUND_KEY,
  backgroundIn,
  toggleBackground,
  type Background,
} from "@/lib/chat-background";
import { questionsIn } from "@/lib/chat-questions";
import { ChatMarkdown } from "./chat-markdown";
import { ChatQuestions, type ChatQuestionLabels } from "./chat-questions";
import { Icon } from "./icons";

// No avatars: they took a column of the narrow chat and said nothing the
// layout does not. The user's messages sit right in a bubble; the wizard's
// answers read as text across the full width.
function MessageRow({
  role,
  assistantLabel,
  markdown = false,
  children,
}: {
  role: ChatRole;
  /** Read out before an assistant message, so a screen reader says who is speaking. */
  assistantLabel: string;
  markdown?: boolean;
  children: React.ReactNode;
}) {
  const isUser = role === "user";
  return (
    <div
      data-testid="chat-message"
      data-role={role}
      className={isUser ? "flex justify-end pl-8" : "pr-2"}
    >
      <div
        className={`text-sm leading-relaxed [overflow-wrap:anywhere] ${markdown ? "chat-md" : "whitespace-pre-wrap"} ${
          isUser
            ? "max-w-full rounded-2xl rounded-br-md bg-brand-soft px-3.5 py-2 text-text"
            : "text-text-secondary"
        }`}
      >
        {!isUser && <span className="sr-only">{assistantLabel}: </span>}
        {children}
      </div>
    </div>
  );
}

// While a reply is on its way (the real agent can take 30–60 s on turn one):
// what the wizard is doing now as shimmering text, and the steps it has
// already taken in this turn as a short list. No clock: the steps tell more
// about progress than seconds counting up.
function ThinkingStatus({ label, steps }: { label: string; steps: string[] }) {
  const current = steps.length ? steps[steps.length - 1] : label;
  const earlier = steps.slice(0, -1).slice(-3);
  return (
    <div className="space-y-1 py-0.5" data-testid="chat-thinking">
      {earlier.length > 0 && (
        <ul className="space-y-0.5 text-xs text-text-muted">
          {earlier.map((step, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <Icon name="check" size={12} className="shrink-0" />
              <span className="min-w-0 truncate">{step}</span>
            </li>
          ))}
        </ul>
      )}
      <span
        role="status"
        className="shimmer-text block truncate text-xs font-medium"
        data-testid="chat-activity"
      >
        {current}
      </span>
    </div>
  );
}

// After the reply, the steps of that turn stay under it, folded away.
function WorkSteps({ summary, steps }: { summary: string; steps: string[] }) {
  return (
    <details className="group mt-2 text-xs text-text-muted" data-testid="chat-steps">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded hover:text-text">
        <Icon name="chevronRight" size={12} className="transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <ol className="mt-1 space-y-0.5 border-l border-border pl-3">
        {steps.map((step, i) => (
          <li key={i} className="[overflow-wrap:anywhere]">
            {step}
          </li>
        ))}
      </ol>
    </details>
  );
}

// Something that happened rather than something said: the wake-up turn a gate
// approval in the panel sends to the agent. The user did not write it, so it
// is not shown as their bubble.
function EventLine({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="chat-event"
      className="flex items-center gap-3 text-xs text-text-muted before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
    >
      <span className="inline-flex items-center gap-1.5">
        <Icon name="circleCheck" size={14} className="text-success-text" />
        {children}
      </span>
    </div>
  );
}

// Before the first message: who is the user? A chip puts one plain sentence at
// the start of the message field; it goes to the agent as the user's own words.
function BackgroundChips({
  labels,
  chosen,
  onChoose,
}: {
  labels: ChatPanelLabels;
  chosen: Background | null;
  onChoose: (background: Background) => void;
}) {
  const names: Record<Background, string> = {
    nonTechnical: labels.nonTechnical,
    technical: labels.technical,
  };
  return (
    <div
      role="group"
      aria-label={labels.background}
      data-testid="chat-background"
      className="flex flex-wrap items-center gap-2"
    >
      <span aria-hidden className="text-xs text-text-muted">
        {labels.background}
      </span>
      {BACKGROUNDS.map((b) => {
        const on = chosen === b;
        return (
          <button
            key={b}
            type="button"
            aria-pressed={on}
            onClick={() => onChoose(b)}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97] ${
              on
                ? "border-brand-soft-border bg-brand-soft text-brand-text"
                : "border-border-strong text-text-secondary hover:border-brand hover:text-brand-text"
            }`}
          >
            {on && <Icon name="check" size={12} />}
            {names[b]}
          </button>
        );
      })}
    </div>
  );
}

function newMessageId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

const NO_QUEUE: QueuedMessage[] = [];

// The steps of finished turns, by session and reply text. They live outside the
// panel so that closing the chat (which unmounts it) or the server's copy of the
// messages (with new ids) does not lose them; a page reload clears them.
const finishedSteps = new Map<string, string[]>();
const stepsKey = (sessionId: string, reply: string) => `${sessionId}\n${reply}`;

export function ChatPanel({
  id,
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
  inputValue,
  onInputChange,
  autoSend,
  busyLabel,
  activityLabels,
  errorLabels,
  questionLabels,
  hideChatLabel,
  onCollapse,
  focusSignal = 0,
  reference = null,
  onReferenceChange,
  showHint = true,
  hidden = false,
  onReplyingChange,
  queue = NO_QUEUE,
  onQueuedTaken,
}: {
  id: string;
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
  inputValue: string;
  onInputChange: (value: string) => void;
  autoSend?: string;
  busyLabel: string;
  activityLabels?: ChatActivityLabels;
  errorLabels?: ChatErrorLabels;
  /** Labels for answering a round of questions one by one. */
  questionLabels?: ChatQuestionLabels;
  /** Label of the button in the header that collapses the chat to its rail. */
  hideChatLabel: string;
  onCollapse: () => void;
  /** Bumped by the dock to move focus into the message field. */
  focusSignal?: number;
  /** The item on the page the next message is about, shown as a chip above the field. */
  reference?: ChatReference | null;
  /** Null removes the chip: the user removed it, or the message about it was sent. */
  onReferenceChange?: (reference: ChatReference | null) => void;
  /** The line under the title that says where changes are asked for. */
  showHint?: boolean;
  /** The chat was closed while a reply is arriving: the panel stays, out of
   *  sight, so the reply is there when the chat is opened again. */
  hidden?: boolean;
  /** Tells the dock whether a reply is arriving. */
  onReplyingChange?: (replying: boolean) => void;
  /** Messages the page sends as they are (CHAT_SEND_EVENT), oldest first. */
  queue?: QueuedMessage[];
  /** Called as a message is taken off the queue to be sent. */
  onQueuedTaken?: (id: number) => void;
}) {
  const panel = activityLabels?.panel;
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState(false);
  useEffect(() => {
    onReplyingChange?.(streaming);
  }, [streaming, onReplyingChange]);
  // The reply whose answer form is sending: the form stays under it, with its
  // answers, until the agent has started on them.
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  // The steps the agent has taken in the running turn (from its tool activity),
  // and those of finished turns, kept for this page view.
  const [turnSteps, setTurnSteps] = useState<string[]>([]);
  const turnStepsRef = useRef<string[]>([]);
  const [stepsByMessage, setStepsByMessage] = useState<Record<string, string[]>>({});
  useEffect(() => {
    for (const m of messages) {
      const steps = stepsByMessage[m.id];
      if (steps && m.content) finishedSteps.set(stepsKey(sessionId, m.content), steps);
    }
  }, [messages, stepsByMessage, sessionId]);
  const stepsOf = (m: ChatMessage) =>
    stepsByMessage[m.id] ?? (m.content ? finishedSteps.get(stepsKey(sessionId, m.content)) : undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputId = `${id}-input`;
  const router = useRouter();

  // Follow the conversation while the reader is at its end; someone who has
  // scrolled up to re-read an answer is left where they are until they send.
  const followRef = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && !hidden && followRef.current) el.scrollTo({ top: el.scrollHeight });
  }, [messages, hidden]);

  // Into the field, after what is already there (a draft, a background sentence).
  const focusInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    if (focusSignal > 0) focusInput();
  }, [focusSignal, focusInput]);

  // Messages appended on the server arrive as new props after revalidation. This state was seeded once, so without adopting
  // them the chat showed nothing until a manual reload: the "no visible
  // feedback" half of #126. Only grow from the server list, so an optimistic
  // message added by `send()` (not yet persisted) is never dropped, and never
  // mid-stream.
  useEffect(() => {
    if (streaming) return;
    setMessages((current) =>
      initialMessages.length > current.length ? initialMessages : current,
    );
  }, [initialMessages, streaming]);

  // Grow the textarea to fit its content (multi-line), capped so it scrolls.
  // Measured before paint, so the box never shows a frame at the wrong height
  // when a message is sent and the field empties. The field is border-box and
  // scrollHeight leaves the borders out: a height of scrollHeight alone was
  // 2 px short, which put a scrollbar beside a one-line message.
  const fitInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const style = window.getComputedStyle(el);
    const borders =
      parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    el.style.height = `${Math.min(el.scrollHeight + borders, 160)}px`;
  }, []);
  useLayoutEffect(fitInput, [inputValue, fitInput]);

  // Measure again when the field's width changes. A chat that was narrow for a
  // moment (closed, opening or dragged) wraps the placeholder onto many lines,
  // and the empty field then stayed that tall after the chat widened again.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (el.offsetWidth === width) return;
      width = el.offsetWidth;
      fitInput();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitInput]);

  // A gate approved in the panel reaches the agent as one chat turn (#173). The
  // page passes it as `autoSend` from the URL the approve action redirected to;
  // it is sent once and the URL is cleaned so a reload does not send it again.
  const autoSent = useRef<string | null>(null);
  useEffect(() => {
    if (!autoSend || streaming || autoSent.current === autoSend) return;
    autoSent.current = autoSend;
    router.replace(window.location.pathname);
    void sendText(autoSend, { retryWhileBusy: true, keepInput: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, streaming]);

  // Messages from the page (a gate rejection's reason) go out one at a time,
  // each once a running reply has finished, like typed ones. The dock drops a
  // message as it is taken, so closing and reopening the chat does not send it
  // again. A wizard still busy with another turn (a gate's wake-up, say) is
  // waited for, as the wake-up itself waits.
  const takenId = useRef<number | null>(null);
  useEffect(() => {
    const next = queue[0];
    if (!next || streaming || takenId.current === next.id) return;
    takenId.current = next.id;
    onQueuedTaken?.(next.id);
    void sendText(next.text, { retryWhileBusy: true, fromPage: true });
    // sendText reads only refs, props and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, streaming]);

  async function send(e?: React.FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    if (streaming) return;
    if (reference) {
      // The message about a chip starts with its line. A chip alone sends nothing.
      const message = referenceMessage(reference.prefix, inputValue);
      if (!message) return;
      const about = reference;
      const typed = inputValue;
      onReferenceChange?.(null);
      // An answer that never reached the agent (the wizard was busy, the
      // message was refused) comes back with its chip, to send again.
      if (!(await sendText(message))) {
        onReferenceChange?.(about);
        onInputChange(typed);
      }
      return;
    }
    await sendText(inputValue);
  }

  // The background chips, while the user has not sent anything yet. The chosen
  // one is the sentence the field starts with, so editing it away unpresses it.
  const backgroundSentences = panel
    ? { nonTechnical: panel.nonTechnicalText, technical: panel.technicalText }
    : null;
  const background = backgroundSentences ? backgroundIn(inputValue, backgroundSentences) : null;
  function chooseBackground(chosen: Background) {
    if (!backgroundSentences) return;
    const next = toggleBackground(inputValue, chosen, backgroundSentences);
    onInputChange(next);
    const now = backgroundIn(next, backgroundSentences);
    try {
      if (now) window.localStorage.setItem(BACKGROUND_KEY, now);
      else window.localStorage.removeItem(BACKGROUND_KEY);
    } catch {
      // Not remembered; the sentence is in the field all the same.
    }
    requestAnimationFrame(focusInput);
  }

  // Resolves true once the agent has started on the message, false when it
  // never reached it (empty, already busy here, refused or failed to start).
  async function sendText(
    raw: string,
    {
      retryWhileBusy = false,
      fromPage = false,
      keepInput,
      onStarted,
      onFailed,
    }: {
      retryWhileBusy?: boolean;
      fromPage?: boolean;
      /** Leave what the user is typing in the field (a page message, a gate's wake-up). */
      keepInput?: boolean;
      /** The agent has started on the message. */
      onStarted?: () => void;
      /** The message never reached the agent; `reason` is what the chat says. */
      onFailed?: (reason: string) => void;
    } = {},
  ): Promise<boolean> {
    const text = raw.trim();
    if (!text || streaming) return false;

    const ts = new Date().toISOString();
    const userId = newMessageId();
    const asstId = newMessageId();
    // A message from the page that never reached the agent goes back to its
    // sender (CHAT_SEND_FAILED_EVENT), so it is not lost.
    let started = false;
    const notDelivered = (reason: string) => {
      if (fromPage) window.dispatchEvent(new CustomEvent(CHAT_SEND_FAILED_EVENT, { detail: text }));
      onFailed?.(reason);
    };

    // A message from the page (a gate rejection's reason, the answers to a
    // round of questions) leaves what the user is typing where it is.
    if (!(keepInput ?? fromPage)) onInputChange("");
    followRef.current = true;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: text, createdAt: ts },
      { id: asstId, role: "assistant", content: "", createdAt: ts },
    ]);
    turnStepsRef.current = [];
    setTurnSteps([]);
    setStreaming(true);

    try {
      let res = await fetch(`/api/sessions/${sessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      // 409: the agent is still answering the previous message; 503: no agent
      // slot is free; 429: the user's own agents are all busy, or they are over
      // the per-minute message limit. The gate wake-up waits (up to a minute)
      // so the approval is not lost; a message the user typed is told to wait.
      const waitable = (status: number) => status === 409 || status === 503 || status === 429;
      for (let attempt = 0; waitable(res.status) && retryWhileBusy && attempt < 12; attempt++) {
        await new Promise((r) => setTimeout(r, 5000));
        res = await fetch(`/api/sessions/${sessionId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
      }
      if (res.status === 409) {
        setMessages((prev) =>
          prev.map((m) => (m.id === asstId ? { ...m, content: `⚠︎ ${busyLabel}` } : m)),
        );
        notDelivered(busyLabel);
        return false;
      }
      const refusalCode =
        res.status === 429 ? ((await res.json().catch(() => ({}))) as { error?: unknown }).error : undefined;
      const refusal = chatRefusalLabel(res.status, refusalCode, errorLabels);
      if (refusal) {
        setMessages((prev) =>
          prev.map((m) => (m.id === asstId ? { ...m, content: `⚠︎ ${refusal}` } : m)),
        );
        notDelivered(refusal);
        return false;
      }
      if (!res.ok || !res.body) throw new Error("stream failed");
      started = true;
      onStarted?.();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.startsWith("data: ") ? frame.slice(6) : frame;
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.error && evt.limit === "turns" && errorLabels) {
            // Not a failure: what the agent did so far stands, and it goes on
            // when the user sends another message.
            const note = `⚠︎ ${errorLabels.turnLimit}`;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstId ? { ...m, content: m.content ? `${m.content}\n\n${note}` : note } : m,
              ),
            );
            continue;
          }
          if (evt.error && evt.code === "agent_busy" && errorLabels) {
            // The agent had to be restarted mid-turn and the user's own
            // agents were all busy: the same message as a 429 agent_busy.
            const note = `⚠︎ ${errorLabels.agentBusy}`;
            setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, content: note } : m)));
            continue;
          }
          if (evt.error) throw new Error("stream error");
          const act = parseActivity(evt);
          if (act && activityLabels) {
            const step = activityText(act, activityLabels);
            if (step !== turnStepsRef.current[turnStepsRef.current.length - 1]) {
              turnStepsRef.current = [...turnStepsRef.current, step];
              setTurnSteps(turnStepsRef.current);
            }
          }
          if (evt.narration_end) {
            // What streamed so far was the agent narrating a tool call, or an
            // internal notice; the reply comes after it (#168).
            setMessages((prev) =>
              prev.map((m) => (m.id === asstId ? { ...m, content: "" } : m)),
            );
          }
          if (evt.delta) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstId ? { ...m, content: m.content + evt.delta } : m,
              ),
            );
          }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === asstId && !m.content
            ? { ...m, content: `⚠︎ ${streamFailedLabel}` }
            : m,
        ),
      );
      if (!started) notDelivered(streamFailedLabel);
    } finally {
      setStreaming(false);
      const steps = turnStepsRef.current;
      if (steps.length) setStepsByMessage((prev) => ({ ...prev, [asstId]: steps }));
      turnStepsRef.current = [];
      setTurnSteps([]);
      // Re-render server components so the requirements checklist / phase reflect
      // any answer recorded during this exchange.
      router.refresh();
    }
    return started;
  }

  // Answers from the form under the reply `replyId`. The form stays there
  // while they are on their way. If they never reach the agent, their bubble
  // and the warning under it are taken back out, so the form is again under
  // the newest reply, with the answers in it, and says why they were not sent.
  async function sendAnswers(replyId: string, message: string): Promise<string | null> {
    const outcome: { failure: string | null } = { failure: null };
    setAnsweringId(replyId);
    const delivered = await sendText(message, {
      retryWhileBusy: true,
      fromPage: true,
      onStarted: () => setAnsweringId(null),
      onFailed: (reason) => {
        outcome.failure = reason;
      },
    });
    setAnsweringId(null);
    if (delivered) return null;
    // Nothing was added to the chat when the send did not get that far.
    if (outcome.failure === null) return streamFailedLabel;
    setMessages((prev) => {
      const at = prev.findIndex((m) => m.id === replyId);
      return at < 0 ? prev : prev.slice(0, at + 1);
    });
    return outcome.failure;
  }

  // Until the user has written anything, the chat greets them and asks who
  // they are; above a real conversation the greeting would only be noise.
  const empty = !messages.some((m) => m.role === "user");
  const referenceId = `${id}-reference`;
  const noticeId = `${id}-ai-notice`;

  return (
    <div id={id} className={`${hidden ? "hidden" : "flex"} h-full min-h-0 flex-col`}>
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border py-1.5 pl-4 pr-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text">{chatTitle}</h2>
          {showHint && panel?.hint && (
            <p className="text-xs text-text-muted" data-testid="chat-hint">
              {panel.hint}
            </p>
          )}
        </div>
        <button
          type="button"
          data-testid="chat-dock-toggle"
          onClick={onCollapse}
          aria-expanded
          aria-controls={id}
          aria-label={hideChatLabel}
          title={hideChatLabel}
          className="icon-btn"
        >
          <Icon name="panelRightClose" size={18} className="max-md:hidden" />
          <Icon name="chevronDown" size={18} className="md:hidden" />
        </button>
      </div>

      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={(e) => {
          const el = e.currentTarget;
          followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="scroll-thin relative flex-1 space-y-4 overflow-auto px-4 py-4"
      >
        {empty && (
          <div className="space-y-3" data-testid="chat-empty">
            <MessageRow role="assistant" assistantLabel={assistantLabel}>
              {greeting}
            </MessageRow>
            {panel && (
              <BackgroundChips labels={panel} chosen={background} onChoose={chooseBackground} />
            )}
          </div>
        )}

        {messages.map((m, i) => {
          const isAsst = m.role === "assistant";
          const approvedGate = !isAsst && panel ? approvedGateIn(m.content) : null;
          if (approvedGate !== null && panel) {
            return <EventLine key={m.id}>{panel.gateApproved.replace("{n}", String(approvedGate))}</EventLine>;
          }
          // Answer fields only under the newest reply, once it has finished,
          // and under the reply being answered while its answers are sent.
          const asking = answeringId ? m.id === answeringId : !streaming && i === messages.length - 1;
          const questions = questionLabels && isAsst && asking ? questionsIn(m.content) : [];
          // The reply being streamed. While the agent works after a remark
          // ("Let me check the spreadsheet"), its text is already on screen,
          // so the progress line goes under it instead of replacing the dots.
          const inProgress = streaming && isAsst && i === messages.length - 1;
          return (
            <MessageRow
              key={m.id}
              role={m.role}
              assistantLabel={assistantLabel}
              markdown={isAsst && !!m.content}
            >
              {m.content ? (
                isAsst ? (
                  <>
                    <ChatMarkdown content={m.content} final={!inProgress} labels={activityLabels} />
                    {inProgress && turnSteps.length > 0 && (
                      <div className="mt-1.5">
                        <ThinkingStatus label={thinkingLabel} steps={turnSteps} />
                      </div>
                    )}
                    {!inProgress && activityLabels && stepsOf(m) && (
                      <WorkSteps
                        summary={activityLabels.steps.replace("{n}", String(stepsOf(m)!.length))}
                        steps={stepsOf(m)!}
                      />
                    )}
                    {questionLabels && questions.length >= 2 && (
                      <ChatQuestions
                        key={m.id}
                        questions={questions}
                        labels={questionLabels}
                        disabled={streaming}
                        onSend={(message) => sendAnswers(m.id, message)}
                      />
                    )}
                  </>
                ) : (
                  m.content
                )
              ) : streaming ? (
                <ThinkingStatus label={thinkingLabel} steps={turnSteps} />
              ) : null}
            </MessageRow>
          );
        })}
      </div>

      <form onSubmit={send} className="shrink-0 border-t border-border px-3 pb-2 pt-3">
        <label htmlFor={inputId} className="sr-only">
          {inputLabel}
        </label>
        {reference && (
          // Keyed by the item, so a new reference comes in as a new chip.
          <div
            key={reference.key}
            data-testid="chat-reference"
            className="chat-chip-in mb-2 flex w-fit max-w-full items-center gap-1.5 rounded-md border border-brand-soft-border bg-brand-soft py-0.5 pl-2 pr-0.5 text-xs text-brand-text"
          >
            <Icon name="messageSquareText" size={13} />
            <span id={referenceId} className="min-w-0 truncate" title={reference.label}>
              {reference.label}
            </span>
            <button
              type="button"
              onClick={() => {
                onReferenceChange?.(null);
                focusInput();
              }}
              aria-label={panel ? `${panel.referenceRemove}: ${reference.label}` : reference.label}
              title={panel?.referenceRemove}
              data-testid="chat-reference-remove"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand-text transition-colors duration-150 hover:bg-brand/10"
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        )}
        {/* One box holds the field and its send button, so nothing beside the
            field moves when it grows to several lines. */}
        <div className="flex items-end gap-1.5 rounded-xl border border-border-strong bg-surface p-1.5 shadow-xs transition-[border-color,box-shadow] focus-within:border-brand focus-within:ring-3 focus-within:ring-brand/30">
          <textarea
            ref={textareaRef}
            id={inputId}
            name="message"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter inserts a newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            // The chip's line goes in front of what is typed here.
            maxLength={Math.max(1, MAX_CHAT_MESSAGE_CHARS - (reference ? reference.prefix.length + 2 : 0))}
            autoComplete="off"
            placeholder={inputPlaceholder}
            aria-describedby={reference ? `${referenceId} ${noticeId}` : noticeId}
            className="scroll-thin max-h-40 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-text-muted focus-in-box focus:outline-none"
          />
          <button
            type="submit"
            disabled={streaming}
            aria-label={sendLabel}
            title={sendLabel}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-on-brand transition-[background-color,transform,opacity] duration-150 hover:bg-brand-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
          >
            {/* The chat shows that the wizard is working; the button only dims. */}
            <Icon name="send" size={16} />
          </button>
        </div>
        {/* Always in view: the replies come from an AI (AI Act art. 50(1)). */}
        <p id={noticeId} className="mt-1.5 px-1 text-xs text-text-muted" data-testid="chat-ai-notice">
          {aiNotice}
        </p>
      </form>
    </div>
  );
}
