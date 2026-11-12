"use client";

import { useMemo, useRef } from "react";
import type { ChatPanelLabels } from "@/lib/chat-activity";
import {
  BACKGROUNDS,
  BACKGROUND_KEY,
  backgroundIn,
  toggleBackground,
  type Background,
} from "@/lib/chat-background";
import { exampleIn, examplesOffered, toggleExample } from "@/lib/session-start";
import { Icon, type IconName } from "./icons";

/**
 * The helpers of a first message: who the user is, and examples to start
 * from. The start view (before a session exists) and an empty session's chat
 * show the same chips, driven by the same hook, so both starts behave alike.
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

const BACKGROUND_ICONS: Record<Background, IconName> = { nonTechnical: "user", technical: "codeXml" };

// Before the first message: who is the user? One of two, in the tools row of
// the message field. The choice puts one plain sentence at the start of the
// field; it goes to the agent as the user's own words. Pressing the chosen one
// again takes the sentence out.
export function BackgroundChoice({
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
  const group = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={labels.background}
      data-testid="chat-background"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-surface-muted p-0.5"
      onKeyDown={(e) => {
        // The arrow keys move the choice, as in any group of radio buttons.
        const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const radios = Array.from(group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
        const at = radios.indexOf(document.activeElement as HTMLButtonElement);
        const next = (Math.max(at, 0) + step + BACKGROUNDS.length) % BACKGROUNDS.length;
        if (chosen !== BACKGROUNDS[next]) onChoose(BACKGROUNDS[next]);
        // A press hands the cursor to the field; the keyboard stays in the group.
        requestAnimationFrame(() => requestAnimationFrame(() => radios[next]?.focus()));
      }}
    >
      {BACKGROUNDS.map((b, i) => {
        const on = chosen === b;
        return (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (chosen === null && i === 0) ? 0 : -1}
            onClick={() => onChoose(b)}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] pointer-coarse:py-1.5 ${
              on ? "bg-surface text-brand-text shadow-xs" : "text-text-secondary hover:text-text"
            }`}
          >
            <Icon name={BACKGROUND_ICONS[b]} size={14} className="shrink-0" />
            {names[b]}
          </button>
        );
      })}
    </div>
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
 * What the chips show for the field's text, and what a press on one does to
 * it. The chosen background is the sentence the field starts with and the
 * chosen example is the text after it, so editing either away unpresses its
 * chip. `focus` puts the cursor back into the field after a press.
 */
export function useStartChips(
  input: string,
  setInput: (value: string) => void,
  panel: ChatPanelLabels | undefined,
  focus: () => void,
) {
  const sentences = useMemo(
    () => (panel ? { nonTechnical: panel.nonTechnicalText, technical: panel.technicalText } : null),
    [panel],
  );
  const prompts = useMemo(
    () => (panel ? panel.start.exampleList.map((example) => example.prompt) : []),
    [panel],
  );

  function chooseBackground(chosen: Background) {
    if (!sentences) return;
    const next = toggleBackground(input, chosen, sentences);
    setInput(next);
    const now = backgroundIn(next, sentences);
    try {
      if (now) window.localStorage.setItem(BACKGROUND_KEY, now);
      else window.localStorage.removeItem(BACKGROUND_KEY);
    } catch {
      // Not remembered; the sentence is in the field all the same.
    }
    focus();
  }

  function chooseExample(index: number) {
    if (!sentences) return;
    setInput(toggleExample(input, prompts[index], prompts, sentences));
    focus();
  }

  return {
    background: sentences ? backgroundIn(input, sentences) : null,
    chooseBackground,
    example: sentences ? exampleIn(input, prompts, sentences) : null,
    examplesShown: sentences ? examplesOffered(input, prompts, sentences) : false,
    chooseExample,
  };
}
