"use client";

import type { BlueprintStepType } from "@/lib/mock-sessions";
import type { Dict } from "@/lib/i18n";
import { askInChat } from "@/lib/chat-events";
import { stepChatAskLabel, stepChatReference } from "@/lib/step-reference";
import { Icon, type IconName } from "@/components/icons";

/**
 * How a process step's type looks wherever the steps are listed (the
 * Blueprint form, the Workflow tab's list, the diagram's properties): one
 * icon and one colour per type, in the same words everywhere.
 */
export const STEP_TYPES: BlueprintStepType[] = ["io", "ai", "human_review"];

/** What kind of step it is, at a glance: data in or out, the model, a person. */
export const STEP_TYPE_ICON: Record<BlueprintStepType, IconName> = {
  io: "arrowRightLeft",
  ai: "brain",
  human_review: "userCheck",
};

/** The step's number on a solid circle in its type's colour. */
const STEP_TYPE_BADGE: Record<BlueprintStepType, string> = {
  io: "bg-step-io",
  ai: "bg-step-ai",
  human_review: "bg-step-human",
};

/** The type icon in the type's colour. */
export const STEP_TYPE_TEXT: Record<BlueprintStepType, string> = {
  io: "text-step-io",
  ai: "text-step-ai",
  human_review: "text-step-human",
};

export function stepTypeLabels(t: Dict): Record<BlueprintStepType, string> {
  return { io: t.wsStepIo, ai: t.wsStepAi, human_review: t.wsStepHuman };
}

export function StepNumber({ n, type }: { n: number; type: BlueprintStepType }) {
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums text-white ${STEP_TYPE_BADGE[type]}`}
      aria-hidden="true"
    >
      {n}
    </span>
  );
}

/** Icon and short label; on a narrow row the label can go (`compact`), the icon keeps its name. */
export function StepTypeTag({
  type,
  label,
  compact = false,
}: {
  type: BlueprintStepType;
  label: string;
  compact?: boolean;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-text-muted" title={label}>
      <Icon name={STEP_TYPE_ICON[type]} size={14} className={STEP_TYPE_TEXT[type]} />
      <span className={compact ? "sr-only" : ""}>{label}</span>
    </span>
  );
}

/**
 * "Muuta chatissa": opens the chat with this step as its reference, so the
 * user can ask the wizard to change exactly this step.
 */
export function AskStepButton({
  step,
  index,
  t,
  className = "",
  withLabel = false,
  testId,
}: {
  step: { id: string; name: string };
  index: number;
  t: Dict;
  className?: string;
  /** Show "Muuta chatissa" next to the icon (the diagram's properties). */
  withLabel?: boolean;
  testId?: string;
}) {
  const label = stepChatAskLabel(step, t);
  return (
    <button
      type="button"
      className={
        withLabel
          ? `inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-brand-text transition-colors hover:bg-brand-soft ${className}`
          : `icon-btn hover:text-brand-text ${className}`
      }
      // The icon alone says nothing, so it is named; a visible label names itself.
      aria-label={withLabel ? undefined : label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        askInChat(stepChatReference(step, index, t));
      }}
      data-testid={testId}
    >
      <Icon name="messageSquareText" size={withLabel ? 14 : 16} />
      {withLabel && t.stepChatButton}
    </button>
  );
}
