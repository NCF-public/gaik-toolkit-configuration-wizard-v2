"use client";

import type { ReactNode } from "react";
import type { Blueprint, BlueprintStep, BlueprintStepType } from "@/lib/mock-sessions";
import type { Dict } from "@/lib/i18n";
import { planSettings } from "@/lib/plan-settings";
import { askInChat } from "@/lib/chat-events";
import { fillTemplate, quoteOneLine } from "@/lib/chat-template";
import { Icon } from "@/components/icons";
import { StepNumber, StepTypeTag, stepTypeLabels } from "@/components/step-type";

// The Blueprint tab's read view (#23, the business-language plan): one card
// per step with its name, kind and description, and the component and its
// settings behind a disclosure. It was a tab of its own ("Suunnitelma") beside
// two others that showed the same steps; editing is one "Edit" away. A step's
// type reads as it does in the form, the Workflow tab's list and the diagram's
// properties: the number on the type's colour, the type's icon and its name
// (components/step-type).

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
  // A setting that holds JSON is for the form, not for an approver to read;
  // the card says how many it leaves out.
  const { readable: settings, hidden } = planSettings(step.settings);
  const component = step.component?.trim() ?? "";
  const hasDetails = component !== "" || settings.length > 0 || hidden > 0;
  const summary =
    component && settings.length > 0 ? t.planDetails : component ? t.planComponentLabel : t.planSettingsLabel;
  const reference = stepReference(step, index, t);
  return (
    <li
      className="rounded-lg border border-border bg-surface py-3 pl-3 pr-2 sm:pl-4"
      data-testid={`plan-step-${index}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-px flex">
          <StepNumber n={index + 1} type={step.type} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-0.5">
            <h3 className="text-sm font-semibold text-text-strong">{step.name}</h3>
            <StepTypeTag type={step.type} label={typeLabel[step.type]} />
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
              {hidden > 0 && (
                <p
                  className="mt-1.5 pl-[18px] text-xs text-text-muted"
                  data-testid={`plan-step-${index}-hidden-settings`}
                >
                  {hidden === 1
                    ? t.planHiddenSettingsOne
                    : t.planHiddenSettingsMany.replace("{n}", String(hidden))}
                </p>
              )}
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
  /** The tab's first row, with the edit control; the goal follows it. */
  action?: ReactNode;
}) {
  const typeLabel = stepTypeLabels(t);

  return (
    <div className="flex max-w-4xl flex-col gap-4 pb-2 pr-1" data-testid="solution-plan-view">
      {action}
      {blueprint.goal && (
        <p className="text-sm leading-relaxed text-text-secondary">
          <span className="font-medium text-text-strong">{t.wsBlueprintGoal}:</span>{" "}
          {blueprint.goal}
        </p>
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
