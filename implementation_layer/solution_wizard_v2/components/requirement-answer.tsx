"use client";

import { askInChat } from "@/lib/chat-events";
import { fillTemplate, quoteOneLine } from "@/lib/chat-template";
import { Icon } from "./icons";

export type RequirementAnswerLabels = {
  /** The button beside an unanswered point. */
  ask: string;
  /** The chip above the chat's field: "{n}" and "{question}". */
  chip: string;
  /** The line the answer starts with: "{n}" and "{question}". */
  prefix: string;
};

/**
 * Answer one requirement point in the chat. The chat opens with the point as
 * a chip and the cursor in its field; the answer then goes as an ordinary
 * message that starts by naming the point, so the agent records it the same
 * way as any answer. The point is the agent's own text, partly from uploaded
 * material, so it goes as a quote on one line: data, not the user's words.
 */
export function RequirementAnswer({
  number,
  question,
  labels,
  next = false,
}: {
  /** The point's place in the checklist, from 1. */
  number: number;
  question: string;
  labels: RequirementAnswerLabels;
  /** The first point without an answer: its button is always in view. */
  next?: boolean;
}) {
  const n = String(number);
  return (
    <button
      type="button"
      onClick={() =>
        askInChat({
          key: `requirement:${number}`,
          label: fillTemplate(labels.chip, { n, question: quoteOneLine(question, 80) }),
          prefix: fillTemplate(labels.prefix, { n, question: quoteOneLine(question) }),
        })
      }
      aria-label={`${labels.ask}: ${question}`}
      data-testid={`requirement-ask-${number}`}
      className={`mt-1 inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium text-brand-text transition-opacity duration-150 ease-out hover:underline sm:mt-0.5 ${
        next
          ? ""
          : "sm:pointer-fine:opacity-0 sm:pointer-fine:group-hover/point:opacity-100 sm:pointer-fine:group-focus-within/point:opacity-100"
      }`}
    >
      <Icon name="messageSquareText" size={13} />
      {labels.ask}
    </button>
  );
}
