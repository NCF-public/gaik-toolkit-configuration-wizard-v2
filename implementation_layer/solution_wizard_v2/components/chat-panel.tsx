"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatMessage, ChatRole } from "@/lib/mock-sessions";
import { renderMarkdown } from "@/lib/markdown";
import {
  activityText,
  elapsedText,
  parseActivity,
  type ChatActivity,
  type ChatActivityLabels,
} from "@/lib/chat-activity";
import { MAX_CHAT_MESSAGE_CHARS, chatRefusalLabel, type ChatErrorLabels } from "@/lib/chat-limits";
import { CHAT_SEND_FAILED_EVENT, type QueuedMessage } from "@/lib/chat-events";
import { questionsIn } from "@/lib/chat-questions";
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

// Shown in the assistant bubble while waiting for the first token — a clear
// "the wizard is thinking" cue (the real agent can take 30–60 s on turn one).
function TypingIndicator({ label, detail }: { label: string; detail?: string | null }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 py-0.5"
      role="status"
      aria-label={detail ? `${label} ${detail}` : label}
    >
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted" />
      {detail && (
        <span className="ml-1.5 text-xs text-text-muted" data-testid="chat-activity">
          {detail}
        </span>
      )}
    </span>
  );
}

function newMessageId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

const NO_QUEUE: QueuedMessage[] = [];

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
  /** Messages handed over from elsewhere on the page, oldest first. */
  queue?: QueuedMessage[];
  /** Called as a message is taken off the queue to be sent. */
  onQueuedTaken?: (id: number) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState(false);
  // The reply whose answer form is sending: the form stays under it, with its
  // answers, until the agent has started on them.
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  // What the agent is doing right now, and when the message was sent, for the
  // progress line under the typing dots.
  const [activity, setActivity] = useState<ChatActivity | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [streaming]);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputId = `${id}-input`;
  const router = useRouter();

  // Follow the conversation while the reader is at its end; someone who has
  // scrolled up to re-read an answer is left where they are until they send.
  const followRef = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && followRef.current) el.scrollTo({ top: el.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (focusSignal > 0) textareaRef.current?.focus();
  }, [focusSignal]);

  // Messages appended on the server — gate approve / request-changes / reject
  // post the reviewer's reason and the wizard's acknowledgement — arrive as new
  // props after revalidation. This state was seeded once, so without adopting
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
    void sendText(autoSend, { retryWhileBusy: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, streaming]);

  // Messages from the page (inline answers) go out one at a time, each once
  // a running reply has finished, like typed ones. The dock drops a message as
  // it is taken, so closing and reopening the chat does not send it again. A
  // wizard still busy with another turn (a gate's wake-up, say) is waited for,
  // as the wake-up itself waits.
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
    await sendText(inputValue);
  }

  // Resolves true once the agent has started on the message, false when it
  // never reached it (empty, already busy here, refused or failed to start).
  async function sendText(
    raw: string,
    {
      retryWhileBusy = false,
      fromPage = false,
      onStarted,
      onFailed,
    }: {
      retryWhileBusy?: boolean;
      fromPage?: boolean;
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
    // sender, so the answer is not lost.
    let started = false;
    const notDelivered = (reason: string) => {
      if (fromPage) window.dispatchEvent(new CustomEvent(CHAT_SEND_FAILED_EVENT, { detail: text }));
      onFailed?.(reason);
    };

    // A message from the page leaves what the user is typing where it is.
    if (!fromPage) onInputChange("");
    followRef.current = true;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: text, createdAt: ts },
      { id: asstId, role: "assistant", content: "", createdAt: ts },
    ]);
    setActivity(null);
    setSentAt(Date.now());
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
          if (act) setActivity(act);
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
      setActivity(null);
      setSentAt(null);
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

  const progressDetail = activityLabels
    ? [
        activity ? activityText(activity, activityLabels) : null,
        sentAt ? elapsedText((now - sentAt) / 1000, activityLabels) : null,
      ]
        .filter(Boolean)
        .join(" · ") || null
    : null;

  return (
    <div id={id} className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border pl-4 pr-2">
        <h2 className="text-sm font-semibold text-text">{chatTitle}</h2>
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
      <p
        className="shrink-0 border-b border-border px-4 py-1.5 text-xs text-text-muted"
        data-testid="chat-ai-notice"
      >
        {aiNotice}
      </p>

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
        <MessageRow role="assistant" assistantLabel={assistantLabel}>
          {greeting}
        </MessageRow>

        {messages.map((m, i) => {
          const isAsst = m.role === "assistant";
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
                    <div
                      className="chat-md-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                    />
                    {inProgress && progressDetail && (
                      <div className="mt-1.5">
                        <TypingIndicator label={thinkingLabel} detail={progressDetail} />
                      </div>
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
                <TypingIndicator label={thinkingLabel} detail={progressDetail} />
              ) : null}
            </MessageRow>
          );
        })}
      </div>

      <form onSubmit={send} className="shrink-0 border-t border-border p-3">
        <label htmlFor={inputId} className="sr-only">
          {inputLabel}
        </label>
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
            maxLength={MAX_CHAT_MESSAGE_CHARS}
            autoComplete="off"
            placeholder={inputPlaceholder}
            className="scroll-thin max-h-40 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-text-muted focus-in-box focus:outline-none"
          />
          <button
            type="submit"
            disabled={streaming}
            aria-label={sendLabel}
            title={sendLabel}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-on-brand transition-[background-color,transform,opacity] duration-150 hover:bg-brand-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
          >
            {streaming ? (
              <Icon name="loaderCircle" size={16} className="animate-spin" />
            ) : (
              <Icon name="send" size={16} />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
