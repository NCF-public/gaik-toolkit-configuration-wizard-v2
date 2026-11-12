"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { startSessionFromMessage } from "@/app/actions";
import { BackgroundChips, ExampleChips, useStartChips } from "@/components/chat-start";
import { Icon } from "@/components/icons";
import type { ChatPanelLabels } from "@/lib/chat-activity";
import { savedBackgroundSentence } from "@/lib/chat-background";
import { MAX_CHAT_MESSAGE_CHARS } from "@/lib/chat-limits";
import { keepFirstMessage } from "@/lib/first-message";
import { FOCUS_START_EVENT } from "@/lib/shell";

export type StartViewLabels = {
  /** The chat's own words: the question, the lede, the chips. */
  panel: ChatPanelLabels;
  inputLabel: string;
  send: string;
  aiNotice: string;
  tooLong: string;
  failed: string;
};

/**
 * Where a session starts: one field. The first message creates the session,
 * named from what it says, and the session's chat sends it as its first turn
 * (lib/first-message). Nothing exists before the send, and nothing typed is
 * lost when the session cannot be created.
 */
export function StartView({ labels }: { labels: StartViewLabels }) {
  const { panel } = labels;
  const start = panel.start;
  const router = useRouter();
  const fieldId = useId();
  const noticeId = `${fieldId}-ai-notice`;
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The message is on its way: everything but the field steps back.
  const [leaving, setLeaving] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Also in a ref: a second Enter arrives before the first has re-rendered.
  const sending = useRef(false);

  // Into the field, after what is already there (a background sentence).
  const focusField = useCallback(() => {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // A viewer who said who they are in an earlier session finds that sentence
  // in the field, still theirs to edit or remove.
  useEffect(() => {
    const sentence = savedBackgroundSentence(panel);
    if (!sentence) return;
    setInput((current) => current || sentence);
    // Once, as the view opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Not on a touch screen, where the cursor would raise the keyboard.
    if (window.matchMedia("(pointer: fine)").matches) requestAnimationFrame(focusField);
    // "New session" pressed while this view is already open.
    window.addEventListener(FOCUS_START_EVENT, focusField);
    return () => window.removeEventListener(FOCUS_START_EVENT, focusField);
  }, [focusField]);

  // The field grows with its text up to a few lines, then scrolls.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    const style = window.getComputedStyle(el);
    const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    el.style.height = `${Math.min(el.scrollHeight + borders, 160)}px`;
  }, [input]);

  const { background, chooseBackground, example, examplesShown, chooseExample } = useStartChips(
    input,
    setInput,
    panel,
    () => {
      field.current?.focus();
      requestAnimationFrame(focusField);
    },
  );

  async function send() {
    const text = input.trim();
    if (!text || sending.current) return;
    sending.current = true;
    setPending(true);
    setLeaving(true);
    setError(null);
    const result = await startSessionFromMessage(text).catch(() => ({ error: "failed" as const }));
    if (!result || "error" in result) {
      // The words stay in the field, to send again.
      sending.current = false;
      setPending(false);
      setLeaving(false);
      if (result?.error !== "empty") {
        setError(result?.error === "too_long" ? labels.tooLong : labels.failed);
      }
      return;
    }
    // The field is not emptied: this view is left as it is for the session's
    // page, where the message appears as the conversation's first and the
    // chat's field starts from where this one stands.
    keepFirstMessage(result.id, { text, fieldTop: box.current?.getBoundingClientRect().top });
    router.push(`/sessions/${result.id}`);
  }

  const stepsBack = leaving || undefined;

  return (
    <>
      <div aria-hidden className="start-backdrop" data-leaving={stepsBack} />
      <div
        data-testid="start-view"
        className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center-safe px-3 pb-[10dvh] pt-14 sm:px-4"
      >
        <div className="start-in start-leaves" data-leaving={stepsBack}>
          <h1 className="flex flex-col items-center gap-4 text-center">
            {/* The logo's own drawing, at a size that names the product. */}
            <Image
              src="/gaik-wordmark.svg"
              alt="GAIK"
              width={882}
              height={303}
              priority
              unoptimized
              className="h-12 w-auto sm:h-16"
            />
            <span className="text-[1.875rem] font-semibold leading-tight tracking-[-0.02em] text-text-strong">
              Solution Wizard
            </span>
          </h1>

          <div className="mt-9 px-1 pb-4 text-center" data-testid="chat-start">
            <h2 className="text-lg font-medium text-text">{start.title}</h2>
            <p className="mx-auto mt-1 max-w-prose text-balance text-sm leading-relaxed text-text-secondary">
              {start.lede}
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor={fieldId} className="sr-only">
            {labels.inputLabel}
          </label>
          {/* One box holds the field and its send button: the view's one
              control, and the one thing on it that is lifted off the page. */}
          <div
            ref={box}
            className="flex items-end gap-1.5 rounded-xl border border-border-strong bg-surface p-2 shadow-md transition-[border-color,box-shadow] duration-150 focus-within:border-brand focus-within:ring-3 focus-within:ring-brand/25"
          >
            <textarea
              ref={field}
              id={fieldId}
              name="message"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter inserts a newline.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={3}
              maxLength={MAX_CHAT_MESSAGE_CHARS}
              readOnly={pending}
              autoComplete="off"
              placeholder={start.placeholder}
              aria-describedby={noticeId}
              className="scroll-thin max-h-40 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-1.5 text-base text-text placeholder:text-text-muted focus-in-box focus:outline-none"
            />
            <button
              type="submit"
              disabled={pending}
              aria-busy={pending || undefined}
              aria-label={labels.send}
              title={labels.send}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-on-brand transition-[background-color,transform,opacity] duration-150 hover:bg-brand-hover active:scale-95 active:bg-brand-active disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
            >
              <Icon
                name={pending ? "loaderCircle" : "send"}
                size={16}
                className={pending ? "animate-spin motion-reduce:animate-none" : ""}
              />
            </button>
          </div>
          {error && (
            <p role="alert" data-testid="start-error" className="mt-2 px-1 text-sm text-danger-text">
              {error}
            </p>
          )}
          {/* The helpers sit under the field they fill. */}
          <div className="start-leaves mt-4 space-y-2.5" data-leaving={stepsBack}>
            <BackgroundChips labels={panel} chosen={background} onChoose={chooseBackground} centered />
            <ExampleChips
              labels={start}
              chosen={example}
              offered={examplesShown}
              onChoose={chooseExample}
            />
          </div>
          {/* Always in view: the replies come from an AI (AI Act art. 50(1)). */}
          <p
            id={noticeId}
            data-testid="chat-ai-notice"
            className="mt-5 px-1 text-center text-xs text-text-muted"
          >
            {labels.aiNotice}
          </p>
        </form>
      </div>
    </>
  );
}
