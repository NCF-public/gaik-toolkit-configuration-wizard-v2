"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ChatPanelLabels } from "@/lib/chat-activity";
import {
  DEFAULT_PACE,
  onBackgroundChange,
  onPaceChange,
  saveBackground,
  savePace,
  savedBackground,
  savedPace,
  type Background,
  type Pace,
} from "@/lib/chat-background";
import { exampleIn, examplesOffered, toggleExample } from "@/lib/session-start";
import { Icon, type IconName } from "./icons";

/**
 * The helpers of a first message: who the user is, how much the wizard asks,
 * and examples to start from. The start view (before a session exists) and an
 * empty session's chat show the same controls, driven by the same hook, so
 * both starts behave alike.
 */

// A chip that puts words into a field and shows whether they are there.
export function chipClass(on: boolean): string {
  // Taller under a finger than under a mouse pointer.
  return `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97] pointer-coarse:py-2 ${
    on
      ? "border-brand-soft-border bg-brand-soft text-brand-text"
      : "border-border-strong text-text-secondary hover:border-brand hover:text-brand-text"
  }`;
}

/** When a choice's labels give way to its icons: the width of the tools row
 *  it stands in (components/composer-card), where the two choices and the
 *  send button share one line. */
type Compact = "narrow" | "narrowest";
const LABEL_HIDDEN: Record<Compact, string> = {
  narrow: "@max-[30rem]:sr-only",
  narrowest: "@max-[18.5rem]:sr-only",
};
const OPTION_TIGHT: Record<Compact, string> = {
  narrow: "@max-[30rem]:px-2",
  narrowest: "@max-[18.5rem]:px-2",
};

// One of two, in the tools row of the message field: a group of radio buttons
// with a thumb behind the chosen one. The choice is state only: nothing is
// written into the field.
function TwoChoice<T extends string>({
  name,
  testId,
  options,
  chosen,
  onChoose,
  compact,
}: {
  /** The group's accessible name. */
  name: string;
  testId: string;
  options: readonly { value: T; label: string; icon: IconName }[];
  chosen: T | null;
  onChoose: (value: T) => void;
  compact: Compact;
}) {
  const group = useRef<HTMLDivElement>(null);
  // The thumb behind the labels: where the chosen option stands in the group.
  // The options differ in width, so it is measured.
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  // The thumb slides only when a press moved it. A choice remembered from an
  // earlier session, or one whose option moved with the window, is in place
  // at once.
  const pressed = useRef(false);
  const [slides, setSlides] = useState(false);

  const place = useCallback(() => {
    const on = group.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    const next = on ? { left: on.offsetLeft, width: on.offsetWidth } : null;
    setThumb((now) => (now?.left === next?.left && now?.width === next?.width ? now : next));
  }, []);
  const labels = options.map((option) => option.label).join("\n");
  // Before the paint, so the thumb is never seen where the choice was.
  useLayoutEffect(() => {
    setSlides(pressed.current);
    pressed.current = false;
    place();
  }, [place, chosen, labels]);
  // The options change width with the row they stand in.
  useEffect(() => {
    const el = group.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setSlides(false);
      place();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [place]);

  function choose(value: T) {
    pressed.current = true;
    onChoose(value);
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={name}
      data-testid={testId}
      className="relative inline-flex shrink-0 items-center gap-0.5 rounded-full bg-surface-muted p-0.5"
      onKeyDown={(e) => {
        // The arrow keys move the choice, as in any group of radio buttons.
        const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const radios = Array.from(group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
        const at = radios.indexOf(document.activeElement as HTMLButtonElement);
        const next = (Math.max(at, 0) + step + options.length) % options.length;
        if (chosen !== options[next].value) choose(options[next].value);
        // A press hands the cursor to the field; the keyboard stays in the group.
        requestAnimationFrame(() => requestAnimationFrame(() => radios[next]?.focus()));
      }}
    >
      {thumb && (
        <span
          aria-hidden
          data-testid={`${testId}-thumb`}
          className={`pointer-events-none absolute inset-y-0.5 left-0 rounded-full bg-surface shadow-xs ${
            slides ? "transition-[transform,width] duration-200 ease-out motion-reduce:transition-none" : ""
          }`}
          style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }}
        />
      )}
      {options.map((option, i) => {
        const on = chosen === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            // Names the option where only its icon is drawn.
            title={option.label}
            tabIndex={on || (chosen === null && i === 0) ? 0 : -1}
            onClick={() => choose(option.value)}
            className={`relative inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-[color,transform] duration-150 ease-out active:scale-[0.97] pointer-coarse:py-1.5 ${OPTION_TIGHT[compact]} ${
              on ? "text-brand-text" : "text-text-secondary hover:text-text"
            } ${
              // Until the thumb is measured (the page as the server sent it),
              // the chosen option carries the thumb's look itself.
              on && !thumb ? "bg-surface shadow-xs" : ""
            }`}
          >
            <Icon name={option.icon} size={14} className="shrink-0" />
            <span className={LABEL_HIDDEN[compact]}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Before the first message: who is the user? The wizard is told with the
// first message (lib/chat-background). Pressing the chosen one again takes
// the choice back.
export function BackgroundChoice({
  labels,
  chosen,
  onChoose,
}: {
  labels: ChatPanelLabels;
  chosen: Background | null;
  onChoose: (background: Background) => void;
}) {
  const options = useMemo(
    () =>
      [
        { value: "nonTechnical", label: labels.nonTechnical, icon: "user" },
        { value: "technical", label: labels.technical, icon: "codeXml" },
      ] as const,
    [labels.nonTechnical, labels.technical],
  );
  return (
    <TwoChoice
      name={labels.background}
      testId="chat-background"
      options={options}
      chosen={chosen}
      onChoose={onChoose}
      // Its labels stay as long as the row has room for them beside the
      // other choice's icons.
      compact="narrowest"
    />
  );
}

// Before the first message: how much does the wizard ask? One of the two is
// always chosen; the wizard is told with the first message, as it is told who
// the user is.
export function PaceChoice({
  labels,
  chosen,
  onChoose,
}: {
  labels: ChatPanelLabels;
  chosen: Pace;
  onChoose: (pace: Pace) => void;
}) {
  const options = useMemo(
    () =>
      [
        { value: "quick", label: labels.quick, icon: "zap" },
        { value: "thorough", label: labels.thorough, icon: "listChecks" },
      ] as const,
    [labels.quick, labels.thorough],
  );
  return (
    <TwoChoice
      name={labels.pace}
      testId="chat-pace"
      options={options}
      chosen={chosen}
      onChoose={onChoose}
      compact="narrow"
    />
  );
}

const EXAMPLE_ICONS = ["fileHeadphone", "fileText", "messageSquareText", "fileSpreadsheet"] as const;

// The start view's examples: a chip puts a first message into the field, for
// the user to edit and send. They are there to start an empty field, so they
// step back once the user writes words of their own, and keep their place in
// the layout meanwhile: nothing moves under the cursor.
export function ExampleChips({
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
      className={`flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 transition-[opacity,visibility] duration-150 ease-out motion-reduce:transition-none ${
        offered ? "" : "invisible opacity-0"
      }`}
    >
      {/* Before the chips on a wide window; on its own line above them on a phone. */}
      <span aria-hidden className="basis-full text-center text-xs text-text-muted sm:basis-auto">
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

/**
 * The choices and the examples of a first message. The choices are kept apart
 * from the field's text and remembered in this browser (lib/chat-background);
 * the chosen example is the text the field holds, so editing it unpresses its
 * chip. `focus` puts the cursor back into the field after a press.
 */
export function useStartChips(
  input: string,
  setInput: (value: string) => void,
  panel: ChatPanelLabels | undefined,
  focus: () => void,
) {
  const prompts = useMemo(
    () => (panel ? panel.start.exampleList.map((example) => example.prompt) : []),
    [panel],
  );
  // Read once the page is in the browser: the server does not know the choices.
  const background = useSyncExternalStore(onBackgroundChange, savedBackground, () => null);
  const pace = useSyncExternalStore(onPaceChange, savedPace, () => DEFAULT_PACE);

  function chooseBackground(chosen: Background) {
    saveBackground(background === chosen ? null : chosen);
    focus();
  }

  function choosePace(chosen: Pace) {
    savePace(chosen);
    focus();
  }

  function chooseExample(index: number) {
    if (!panel) return;
    setInput(toggleExample(input, prompts[index], prompts));
    focus();
  }

  return {
    background: panel ? background : null,
    chooseBackground,
    pace,
    choosePace,
    example: panel ? exampleIn(input, prompts) : null,
    examplesShown: panel ? examplesOffered(input, prompts) : false,
    chooseExample,
  };
}

/**
 * The lines that tell the wizard the choices, in the interface's language and
 * in the order they are sent: who the user is, then how much to ask. The
 * choices are read as they stand now unless they are given.
 */
export function startLines(
  panel: ChatPanelLabels | undefined,
  chosen: { background: Background | null; pace: Pace } = {
    background: savedBackground(),
    pace: savedPace(),
  },
): string[] {
  if (!panel) return [];
  const lines: string[] = [];
  if (chosen.background) {
    lines.push(chosen.background === "technical" ? panel.technicalText : panel.nonTechnicalText);
  }
  lines.push(chosen.pace === "thorough" ? panel.thoroughText : panel.quickText);
  return lines;
}
