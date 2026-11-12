"use client";

import { useMemo } from "react";
import type { ChatPanelLabels } from "@/lib/chat-activity";
import {
  BACKGROUNDS,
  BACKGROUND_KEY,
  backgroundIn,
  toggleBackground,
  type Background,
} from "@/lib/chat-background";
import { exampleIn, examplesOffered, toggleExample } from "@/lib/session-start";
import { Icon } from "./icons";

/**
 * The helpers of a first message: who the user is, and examples to start
 * from. The start view (before a session exists) and an empty session's chat
 * show the same chips, driven by the same hook, so both starts behave alike.
 */

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
export function BackgroundChips({
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
      className={`flex flex-wrap items-center justify-center gap-2 transition-[opacity,visibility] duration-150 ease-out motion-reduce:transition-none ${
        offered ? "" : "invisible opacity-0"
      }`}
    >
      {/* The name has its own line, so the chips sit evenly under it at any width. */}
      <span aria-hidden className="basis-full text-center text-xs text-text-muted">
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
