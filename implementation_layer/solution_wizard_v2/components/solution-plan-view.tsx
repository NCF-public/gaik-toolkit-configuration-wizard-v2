"use client";

import type { ReactNode } from "react";
import type { Blueprint, BlueprintStep, BlueprintStepType } from "@/lib/mock-sessions";
import type { Dict } from "@/lib/i18n";
import { readableSettings } from "@/lib/plan-settings";
import { askInChat } from "@/lib/chat-events";
import { fillTemplate, quoteOneLine } from "@/lib/chat-template";
import { Icon, type IconName } from "@/components/icons";

// The Blueprint tab's read view (#23, the business-language plan): one card
// per step with its name, kind and description, and the component and its
// settings behind a disclosure. It was a tab of its own ("Suunnitelma") beside
// two others that showed the same steps; editing is one "Edit" away.

const TYPE_ICON: Record<BlueprintStepType, IconName> = {
  io: "arrowRightLeft",
  ai: "brain",
  human_review: "userCheck",
};

const TYPE_CHIP: Record<BlueprintStepType, string> = {
  io: "bg-surface-muted text-text-secondary",
  ai: "bg-brand-soft text-brand-text",
  human_review: "bg-warning-bg text-warning-text",
};

function stepReference(step: BlueprintStep, index: number, t: Dict) {
  const n = String(index + 1);
  return {
    key: `step:${step.id}`,
    // An unnamed step is "Vaihe 3", not "Vaihe 3 · ".
    label: fillTemplate(t.planStepRefLabel, { n, name: step.name.trim() }).replace(/\s*·\s*$/, ""),
    // The name and id are the agent's words: they travel as a marked quote.
    prefix: fillTemplate(t.planStepRefPrefix, {
      n,
      id: quoteOneLine(step.id, 80),
      name: quoteOneLine(step.name),
    }),
  };
}

function StepCard({
  step,
  index,
  typeLabel,
  t,
}: {
  step: BlueprintStep;
  index: number;
  typeLabel: Record<BlueprintStepType, string>;
  t: Dict;
}) {
  const settings = readableSettings(step.settings);
  const component = step.component?.trim() ?? "";
  const hasDetails = component !== "" || settings.length > 0;
  const summary =
    component && settings.length > 0 ? t.planDetails : component ? t.planComponentLabel : t.planSettingsLabel;
  const reference = stepReference(step, index, t);
  return (
    <li
      className="rounded-lg border border-border bg-surface py-3 pl-3 pr-2 sm:pl-4"
      data-testid={`plan-step-${index}`}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong text-xs font-semibold text-text-secondary"
          aria-hidden
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
            <h3 className="text-sm font-semibold text-text-strong">{step.name}</h3>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${TYPE_CHIP[step.type]}`}
            >
              <Icon name={TYPE_ICON[step.type]} size={12} />
              {typeLabel[step.type]}
            </span>
          </div>
          {step.description && (
            <p className="mt-1 text-sm leading-relaxed text-text-secondary">{step.description}</p>
          )}
          {hasDetails && (
            <details className="group mt-2">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs font-medium text-text-muted transition-colors hover:text-text [&::-webkit-details-marker]:hidden">
                <Icon
                  name="chevronRight"
                  size={13}
                  className="transition-transform duration-150 ease-out group-open:rotate-90"
                />
                {summary}
              </summary>
              <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 pl-[18px] text-xs">
                {component && (
                  <>
                    <dt className="text-text-muted">{t.planComponentLabel}</dt>
                    <dd className="break-words text-text">{component}</dd>
                  </>
                )}
                {settings.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-mono text-text-muted">{k}</dt>
                    <dd className="break-words text-text">{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
        <button
          type="button"
          className="icon-btn -mt-1"
          onClick={() => askInChat(reference)}
          aria-label={`${t.planAskInChat}: ${reference.label}`}
          title={t.planAskInChat}
          data-testid={`plan-step-${index}-ask`}
        >
          <Icon name="messageSquareText" size={16} />
        </button>
      </div>
    </li>
  );
}

export function SolutionPlanView({
  blueprint,
  t,
  action,
}: {
  blueprint: Blueprint;
  t: Dict;
  /** The edit control, at the top beside the goal. */
  action?: ReactNode;
}) {
  const typeLabel: Record<BlueprintStepType, string> = {
    io: t.wsStepIo,
    ai: t.wsStepAi,
    human_review: t.wsStepHuman,
  };

  return (
    <div className="flex max-w-4xl flex-col gap-4 pb-2" data-testid="solution-plan-view">
      {(blueprint.goal || action) && (
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          {blueprint.goal ? (
            <p className="min-w-0 flex-1 basis-72 text-sm leading-relaxed text-text-secondary">
              <span className="font-medium text-text-strong">{t.wsBlueprintGoal}:</span>{" "}
              {blueprint.goal}
            </p>
          ) : (
            <span className="flex-1" />
          )}
          {action}
        </div>
      )}

      {blueprint.steps.length === 0 ? (
        <p className="text-sm text-text-muted">{t.planEmptySteps}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {blueprint.steps.map((step, index) => (
            <StepCard key={step.id} step={step} index={index} typeLabel={typeLabel} t={t} />
          ))}
        </ol>
      )}
    </div>
  );
}
