"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type { ChatMessage, ChatRole, PendingTurn } from "@/lib/mock-sessions";
import {
  activityText,
  parseActivity,
  type ChatActivityLabels,
  type ChatPanelLabels,
} from "@/lib/chat-activity";
import { MAX_CHAT_MESSAGE_CHARS, chatRefusalLabel, type ChatErrorLabels } from "@/lib/chat-limits";
import {
  CHAT_REPLYING_EVENT,
  CHAT_SEND_DELIVERED_EVENT,
  CHAT_SEND_EVENT,
  CHAT_SEND_FAILED_EVENT,
  type ChatReference,
  type QueuedMessage,
} from "@/lib/chat-events";
import { setLocale } from "@/app/locale-actions";
import { withoutStepParams } from "@/lib/step-redirect";
import { approvedGateIn, referenceMessage } from "@/lib/chat-reference";
import {
  BACKGROUNDS,
  BACKGROUND_KEY,
  backgroundIn,
  toggleBackground,
  type Background,
} from "@/lib/chat-background";
import { questionsIn } from "@/lib/chat-questions";
import { exampleIn, examplesOffered, toggleExample } from "@/lib/session-start";
import { ChatMarkdown } from "./chat-markdown";
import { ChatQuestions, type ChatQuestionLabels } from "./chat-questions";
import { Icon, type IconName } from "./icons";

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

// A chip that puts words into the message field and shows whether they are there.
function chipClass(on: boolean): string {
  // Taller under a finger than under a mouse pointer.
  return `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97] pointer-coarse:py-2 ${
    on
      ? "border-brand-soft-border bg-brand-soft text-brand-text"
      : "border-border-strong text-text-secondary hover:border-brand hover:text-brand-text"
  }`;
}

// Before the first message: who is the user? A chip puts one plain sentence at
// the start of the message field; it goes to the agent as the user's own words.
function BackgroundChips({
  labels,
  chosen,
  onChoose,
  centered = false,
}: {
  labels: ChatPanelLabels;
  chosen: Background | null;
  onChoose: (background: Background) => void;
  /** Under the field of the start view, where everything sits on its middle line. */
  centered?: boolean;
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
      className={`flex flex-wrap items-center gap-2 ${centered ? "justify-center" : ""}`}
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
            className={chipClass(on)}
          >
            {on && <Icon name="check" size={12} />}
            {names[b]}
          </button>
        );
      })}
    </div>
  );
}

const EXAMPLE_ICONS: IconName[] = ["fileHeadphone", "fileText", "messageSquareText", "fileSpreadsheet"];

// The start view's examples: a chip puts a first message into the field, for
// the user to edit and send. They are there to start an empty field, so they
// step back once the user writes words of their own, and keep their place in
// the layout meanwhile: nothing moves under the cursor.
function ExampleChips({
  labels,
  chosen,
  offered,
  onChoose,
}: {
  labels: ChatPanelLabels["start"];
  chosen: number | null;
  offered: boolean;
  onChoose: (index: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label={labels.examples}
      data-testid="chat-examples"
      className={`flex flex-wrap items-center justify-center gap-2 transition-[opacity,visibility] duration-150 ease-out motion-reduce:transition-none ${
        offered ? "" : "invisible opacity-0"
      }`}
    >
      {/* On a phone the name has its own line, so the chips wrap evenly under it. */}
      <span aria-hidden className="text-xs text-text-muted max-sm:basis-full max-sm:text-center">
        {labels.examples}
      </span>
      {labels.exampleList.map((example, i) => {
        const on = chosen === i;
        return (
          <button
            key={example.title}
            type="button"
            aria-pressed={on}
            title={example.prompt}
            onClick={() => onChoose(i)}
            className={chipClass(on)}
          >
            <Icon name={on ? "check" : (EXAMPLE_ICONS[i] ?? "fileText")} size={12} />
            {example.title}
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

// The steps of finished turns, by session, reply text and which reply with
// that text it is (two replies that read the same keep their own steps). They
// live outside the panel so that closing the chat (which unmounts it) or the
// server's copy of the messages (with new ids) does not lose them; a page
// reload clears them, and only the newest MAX_FINISHED_STEPS replies are kept.
const MAX_FINISHED_STEPS = 200;
const finishedSteps = new Map<string, string[]>();

/** Each assistant reply's key in `finishedSteps`, by message id. */
function stepsKeys(sessionId: string, messages: ChatMessage[]): Map<string, string> {
  const seen = new Map<string, number>();
  const keys = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "assistant" || !m.content) continue;
    const nth = seen.get(m.content) ?? 0;
    seen.set(m.content, nth + 1);
    keys.set(m.id, `${sessionId}\n${nth}\n${m.content}`);
  }
  return keys;
}

function rememberSteps(key: string, steps: string[]) {
  finishedSteps.delete(key); // written again, it is the newest
  finishedSteps.set(key, steps);
  for (const oldest of finishedSteps.keys()) {
    if (finishedSteps.size <= MAX_FINISHED_STEPS) break;
    finishedSteps.delete(oldest);
  }
}

/** The stream itself said the turn failed: nothing to read again. */
class ReplyFailed extends Error {}

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
  lead = false,
  onReplyingChange,
  queue = NO_QUEUE,
  onQueuedTaken,
  pendingTurn = null,
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
  /** The chat is the page (lib/session-start): one column on the page's middle
   *  line, without the dock's title bar, and an empty one opens as a start view. */
  lead?: boolean;
  /** Tells the dock whether a reply is arriving. */
  onReplyingChange?: (replying: boolean) => void;
  /** Messages the page sends as they are (CHAT_SEND_EVENT), oldest first. */
  queue?: QueuedMessage[];
  /** Called as a message is taken off the queue to be sent. */
  onQueuedTaken?: (id: number) => void;
  /** The message the wizard is answering although this panel did not send it:
   *  the page was reloaded mid-reply, or another tab sent it. */
  pendingTurn?: PendingTurn | null;
}) {
  const panel = activityLabels?.panel;
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  // The start view: the chat is the page and nothing has been said in it yet.
  // A page loaded in the middle of the first reply already has a conversation.
  const start = lead && messages.length === 0 && !pendingTurn && panel ? panel.start : null;
  const [streaming, setStreamingState] = useState(false);
  // Also in a ref: an effect that fires on new page data must know whether a
  // reply is on screen now, not when the effect was created.
  const streamingRef = useRef(false);
  const setStreaming = useCallback((value: boolean) => {
    streamingRef.current = value;
    setStreamingState(value);
  }, []);
  useEffect(() => {
    onReplyingChange?.(streaming);
    window.dispatchEvent(new CustomEvent<boolean>(CHAT_REPLYING_EVENT, { detail: streaming }));
  }, [streaming, onReplyingChange]);
  // Asked for the other language, the wizard offers the switch as a button
  // under its reply (the reply language follows the interface language, which
  // only the user can set). Pressing it switches the interface and tells the
  // wizard to go on in that language.
  const [languageOffer, setLanguageOffer] = useState<{
    replyId: string;
    locale: "fi" | "en";
  } | null>(null);
  const [switchingLanguage, startLanguageSwitch] = useTransition();
  function switchLanguage(locale: "fi" | "en") {
    const offer = panel?.languageOffer[locale];
    if (!offer) return;
    startLanguageSwitch(async () => {
      const data = new FormData();
      data.set("locale", locale);
      try {
        await setLocale(data);
      } catch {
        // The switch did not go through: the button stays, to press again.
        return;
      }
      setLanguageOffer(null);
      // The button is gone with the offer; the field is where the user goes on.
      focusInput();
      window.dispatchEvent(new CustomEvent(CHAT_SEND_EVENT, { detail: offer.message }));
    });
  }
  // A typed message was refused because the wizard is answering another one:
  // said above the field until the next send.
  const [busyNote, setBusyNote] = useState(false);
  // The reply whose answer form is sending: the form stays under it, with its
  // answers, until the agent has started on them.
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  // The steps the agent has taken in the running turn (from its tool activity),
  // and those of finished turns, kept for this page view.
  const [turnSteps, setTurnSteps] = useState<string[]>([]);
  const turnStepsRef = useRef<string[]>([]);
  const [stepsByMessage, setStepsByMessage] = useState<Record<string, string[]>>({});
  const keysOfSteps = useMemo(() => stepsKeys(sessionId, messages), [sessionId, messages]);
  useEffect(() => {
    for (const m of messages) {
      const steps = stepsByMessage[m.id];
      const key = keysOfSteps.get(m.id);
      if (steps && key) rememberSteps(key, steps);
    }
  }, [messages, stepsByMessage, keysOfSteps]);
  const stepsOf = (m: ChatMessage) => {
    const key = keysOfSteps.get(m.id);
    return stepsByMessage[m.id] ?? (key ? finishedSteps.get(key) : undefined);
  };
  // The messages the user sent from this panel, by id. One of them is never
  // shown as a gate approval, whatever it says.
  const typedIds = useRef(new Set<string>());
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
  // The start view's field is a few lines tall; it is one line again once the
  // conversation has begun.
  const fieldRows = start ? 3 : 1;
  useLayoutEffect(fitInput, [inputValue, fitInput, fieldRows]);

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
    // Only the wake-up leaves the address; the open tab stays in it.
    router.replace(withoutStepParams(window.location.pathname, window.location.search));
    void sendText(autoSend, { retryWhileBusy: true, keepInput: true, typed: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, streaming]);

  // What is in the field and above it now, for a send that fails after the
  // user has gone on writing.
  const latestInput = useRef(inputValue);
  latestInput.current = inputValue;
  const latestReference = useRef(reference);
  latestReference.current = reference;

  // Messages from the page (a gate rejection's reason) go out one at a time,
  // each once a running reply has finished, like typed ones. The dock drops a
  // message as it is taken, so closing and reopening the chat does not send it
  // again. A wizard still busy with another turn (a gate's wake-up, say) is
  // waited for, as the wake-up itself waits.
  const takenId = useRef<number | null>(null);
  // The last typed message was refused because the wizard was answering another.
  const busyRefused = useRef(false);
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
      // message was refused) comes back with its chip, to send again. What
      // the user wrote or picked in the meantime stays as it is.
      if (!(await sendText(message))) {
        const wroteMore = latestInput.current.trim() !== "";
        if (!wroteMore && !latestReference.current) onReferenceChange?.(about);
        if (!wroteMore) onInputChange(typed);
      }
      return;
    }
    const typed = inputValue;
    if (!(await sendText(typed)) && busyRefused.current && !latestInput.current.trim()) {
      // Refused because another reply is on its way: the words come back.
      onInputChange(typed);
    }
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
    // Into the field at once, so words typed straight after the click go
    // after the sentence; the cursor is put at its end once it is drawn.
    textareaRef.current?.focus();
    requestAnimationFrame(focusInput);
  }

  // The start view's examples: the chosen one is the text the field holds
  // after the background sentence, so editing it unpresses the chip.
  const examplePrompts = useMemo(
    () => (panel ? panel.start.exampleList.map((example) => example.prompt) : []),
    [panel],
  );
  const example = backgroundSentences
    ? exampleIn(inputValue, examplePrompts, backgroundSentences)
    : null;
  const examplesShown = backgroundSentences
    ? examplesOffered(inputValue, examplePrompts, backgroundSentences)
    : false;
  function chooseExample(index: number) {
    if (!backgroundSentences) return;
    onInputChange(
      toggleExample(inputValue, examplePrompts[index], examplePrompts, backgroundSentences),
    );
    textareaRef.current?.focus();
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
      typed = true,
      onStarted,
      onFailed,
    }: {
      retryWhileBusy?: boolean;
      fromPage?: boolean;
      /** Leave what the user is typing in the field (a page message, a gate's wake-up). */
      keepInput?: boolean;
      /** False for the wake-up turn the page sends after a gate approval. */
      typed?: boolean;
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
    if (typed) typedIds.current.add(userId);
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
    busyRefused.current = false;
    setBusyNote(false);
    // An offer under an earlier reply is not this turn's.
    setLanguageOffer(null);
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
        if (typed && !fromPage && !retryWhileBusy) {
          // The wizard is answering a message sent elsewhere (another tab, or
          // before a reload). What the user wrote goes back into the field,
          // and the reply on its way is shown here once the page has read it.
          setMessages((prev) => prev.filter((m) => m.id !== userId && m.id !== asstId));
          busyRefused.current = true;
          setBusyNote(true);
          onFailed?.(busyLabel);
          return false;
        }
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
      if (fromPage) window.dispatchEvent(new CustomEvent(CHAT_SEND_DELIVERED_EVENT, { detail: text }));
      onStarted?.();

      let whole = false;
      try {
        whole = await readReply(res.body, asstId);
      } catch (err) {
        if (err instanceof ReplyFailed) throw err;
      }
      // The connection broke, or was closed on the way, while the wizard goes
      // on answering: the reply is read again from the turn that is running.
      if (!whole && !(await rejoinReply(userId, asstId))) throw new Error("stream lost");
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
      turnEnded(asstId);
    }
    return started;
  }

  // The reply this panel sent for lost its connection: a network that changed,
  // a proxy that closed a long response. The turn goes on at the server, and
  // the next message would be refused as "still finishing" until a reload.
  // Reads the running turn from its start into the same message, as a
  // reloaded page does. False when it cannot be reached.
  async function rejoinReply(userId: string, asstId: string): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      try {
        const res = await fetch(`/api/sessions/${sessionId}/chat/stream`, { cache: "no-store" });
        if (res.status === 204) {
          // It ended in the meantime: the stored conversation has the whole
          // exchange, and the page reads it as the turn ends.
          setMessages((prev) => prev.filter((m) => m.id !== userId && m.id !== asstId));
          return true;
        }
        if (res.status !== 200 || !res.body) continue;
        setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, content: "" } : m)));
        turnStepsRef.current = [];
        setTurnSteps([]);
        if (await readReply(res.body, asstId)) return true;
      } catch (err) {
        if (err instanceof ReplyFailed) throw err;
        // Still no connection: try again.
      }
    }
    return false;
  }

  // Reads one reply's frames into the assistant message `asstId`, until the
  // stream closes (the exchange is stored by then). Throws ReplyFailed when
  // the stream reports a failure, and whatever the connection throws when it
  // breaks. True when the stream said how the turn ended (its last frame, or a
  // limit it told about); false when it just stopped.
  async function readReply(body: ReadableStream<Uint8Array>, asstId: string): Promise<boolean> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let ended = false;

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
        if (evt.done || evt.error) ended = true;
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
        if (evt.error) throw new ReplyFailed();
        // The agent changed the session itself (it reopened a gate): the page
        // shows that now, not when the reply is whole.
        if (evt.session_changed) router.refresh();
        if (evt.offer_locale === "fi" || evt.offer_locale === "en") {
          setLanguageOffer({ replyId: asstId, locale: evt.offer_locale });
        }
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
    return ended;
  }

  // A reply is whole (or has failed): its steps fold away under it and the
  // page reads the session again, so the step, the gates and the tabs show
  // what this exchange changed.
  function turnEnded(asstId: string) {
    setStreaming(false);
    const steps = turnStepsRef.current;
    if (steps.length) setStepsByMessage((prev) => ({ ...prev, [asstId]: steps }));
    turnStepsRef.current = [];
    setTurnSteps([]);
    router.refresh();
  }

  // The wizard is answering a message this panel did not send: the page was
  // reloaded mid-reply (the reply used to be lost, and the next message was
  // refused as "still finishing"), or another tab sent it. The message and
  // the reply so far are shown, and the rest arrives as it would have.
  async function joinTurn(userMessage: string) {
    const ts = new Date().toISOString();
    const userId = newMessageId();
    const asstId = newMessageId();
    followRef.current = true;
    // The reply the note spoke of is the one shown from here on.
    setBusyNote(false);
    setLanguageOffer(null);
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: userMessage, createdAt: ts },
      { id: asstId, role: "assistant", content: "", createdAt: ts },
    ]);
    turnStepsRef.current = [];
    setTurnSteps([]);
    setStreaming(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/chat/stream`, { cache: "no-store" });
      if (res.status !== 200 || !res.body) {
        // The reply was finished in the meantime: the stored conversation has
        // it, and the page reads it below.
        setMessages((prev) => prev.filter((m) => m.id !== userId && m.id !== asstId));
        return;
      }
      await readReply(res.body, asstId);
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === asstId && !m.content ? { ...m, content: `⚠︎ ${streamFailedLabel}` } : m,
        ),
      );
    } finally {
      turnEnded(asstId);
    }
  }

  // Joined once per turn. A turn this panel is already showing (it sent the
  // message, and the page data was read again mid-reply) is not joined.
  const joinedTurn = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingTurn || joinedTurn.current === pendingTurn.startedAt) return;
    joinedTurn.current = pendingTurn.startedAt;
    if (streamingRef.current) return;
    void joinTurn(pendingTurn.userMessage);
    // joinTurn reads only refs, props and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTurn]);

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
  // While the chat is the page, the conversation and the field share one
  // column on the page's middle line.
  const column = lead ? "mx-auto w-full max-w-3xl" : "";

  return (
    <div
      id={id}
      className={`${hidden ? "hidden" : "flex"} min-h-0 flex-1 flex-col ${
        // The start view sits a little above the middle, as one group. In a
        // window too short for it (a phone on its side, the steps opened
        // above it) it starts at the top and scrolls instead of spilling out.
        start ? "scroll-thin justify-center-safe overflow-y-auto pb-[10dvh]" : ""
      }`}
    >
      {lead ? (
        start ? (
          <div className="shrink-0 px-4 pb-6 text-center" data-testid="chat-start">
            <h2 className="text-2xl font-semibold tracking-tight text-text sm:text-3xl">
              {start.title}
            </h2>
            <p className="mx-auto mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
              {start.lede}
            </p>
          </div>
        ) : (
          // The page header names the session; the chat needs no bar of its own.
          <h2 className="sr-only">{chatTitle}</h2>
        )
      ) : (
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
      )}

      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={(e) => {
          const el = e.currentTarget;
          followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        // Nothing to show in the start view: the log takes no room there.
        className={`scroll-thin relative overflow-auto ${start ? "shrink-0" : "flex-1 px-4 py-4"}`}
      >
        <div className={`space-y-4 ${column}`}>
        {empty && !start && (
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
          const approvedGate =
            !isAsst && panel && !typedIds.current.has(m.id) ? approvedGateIn(m.content) : null;
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
                    {languageOffer?.replyId === m.id && panel && (
                      <button
                        type="button"
                        disabled={switchingLanguage || streaming}
                        onClick={() => switchLanguage(languageOffer.locale)}
                        data-testid="chat-language-offer"
                        className="btn-secondary mt-2 px-3 py-1.5 text-xs"
                      >
                        {panel.languageOffer[languageOffer.locale].label}
                      </button>
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
      </div>

      <form
        onSubmit={send}
        className={`shrink-0 px-3 pb-2 ${lead ? "sm:px-4" : "border-t border-border pt-3"}`}
      >
        <div className={column}>
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
        {busyNote && (
          <p role="status" data-testid="chat-busy-note" className="mb-2 px-1 text-xs text-warning-text">
            {busyLabel}
          </p>
        )}
        {/* One box holds the field and its send button, so nothing beside the
            field moves when it grows to several lines. */}
        <div
          className={`flex items-end gap-1.5 rounded-xl border border-border-strong bg-surface transition-[border-color,box-shadow] focus-within:border-brand focus-within:ring-3 focus-within:ring-brand/30 ${
            // The start view's one control: a little larger and lifted.
            start ? "p-2 shadow-sm" : "p-1.5 shadow-xs"
          }`}
        >
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
            rows={fieldRows}
            // The chip's line goes in front of what is typed here.
            maxLength={Math.max(1, MAX_CHAT_MESSAGE_CHARS - (reference ? reference.prefix.length + 2 : 0))}
            autoComplete="off"
            placeholder={start ? start.placeholder : inputPlaceholder}
            aria-describedby={reference ? `${referenceId} ${noticeId}` : noticeId}
            className={`scroll-thin max-h-40 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-1.5 text-text placeholder:text-text-muted focus-in-box focus:outline-none ${
              start ? "text-base" : "text-sm"
            }`}
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
        {/* The start view's helpers sit under the field they fill. */}
        {start && panel && (
          <div className="mt-4 space-y-2.5">
            <BackgroundChips
              labels={panel}
              chosen={background}
              onChoose={chooseBackground}
              centered
            />
            <ExampleChips
              labels={start}
              chosen={example}
              offered={examplesShown}
              onChoose={chooseExample}
            />
          </div>
        )}
        {/* Always in view: the replies come from an AI (AI Act art. 50(1)). */}
        <p
          id={noticeId}
          className={`px-1 text-xs text-text-muted ${start ? "mt-5 text-center" : "mt-1.5"}`}
          data-testid="chat-ai-notice"
        >
          {aiNotice}
        </p>
        </div>
      </form>
    </div>
  );
}
