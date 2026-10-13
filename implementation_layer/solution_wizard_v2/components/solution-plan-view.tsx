import type { Blueprint, BlueprintStep, BlueprintStepType } from "@/lib/mock-sessions";
import type { Dict } from "@/lib/i18n";

// Business-language solution plan (SME-5, Dmitry 14 Aug — "something for
// improvement this sprint, how it should look"). Same content as the
// blueprint/BPMN, reframed as inputs / steps / outputs / human checks instead
// of JSON fields or diagram notation.

const TYPE_STYLE: Record<BlueprintStepType, string> = {
  io: "border-l-step-io",
  ai: "border-l-step-ai",
  human_review: "border-l-step-human",
};

function classifyIO(steps: BlueprintStep[]): {
  inputs: BlueprintStep[];
  outputs: BlueprintStep[];
} {
  let firstNonIo = steps.findIndex((s) => s.type !== "io");
  if (firstNonIo === -1) firstNonIo = steps.length;
  let lastNonIo = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].type !== "io") {
      lastNonIo = i;
      break;
    }
  }
  const inputs = steps.slice(0, firstNonIo).filter((s) => s.type === "io");
  const outputs =
    lastNonIo === -1 ? [] : steps.slice(lastNonIo + 1).filter((s) => s.type === "io");
  return { inputs, outputs };
}

function StepCard({ step, index, t }: { step: BlueprintStep; index: number; t: Dict }) {
  const roleLabel =
    step.type === "ai" ? t.planRoleAi : step.type === "human_review" ? t.planRoleHuman : t.planRoleIo;
  const settings = Object.entries(step.settings ?? {});
  return (
    <li
      className={`rounded-lg border border-border bg-surface-muted/40 border-l-4 p-3 ${TYPE_STYLE[step.type]}`}
      data-testid={`plan-step-${index}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-text-strong">
          {index + 1}. {step.name}
        </span>
        <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-text-muted">
          {roleLabel}
        </span>
      </div>
      {step.description && (
        <p className="mt-1 text-xs text-text-secondary">{step.description}</p>
      )}
      {step.component && (
        <p className="mt-1 text-xs text-text-muted">
          <span className="font-medium text-text-secondary">{t.planComponentLabel}:</span>{" "}
          {step.component}
        </p>
      )}
      <div className="mt-1 text-xs text-text-muted">
        <span className="font-medium text-text-secondary">{t.planSettingsLabel}:</span>{" "}
        {settings.length === 0 ? (
          t.planNoSettingsLabel
        ) : (
          <span>
            {settings.map(([k, v], i) => (
              <span key={k}>
                {i > 0 && ", "}
                {k}={v || "—"}
              </span>
            ))}
          </span>
        )}
      </div>
    </li>
  );
}

export function SolutionPlanView({ blueprint, t }: { blueprint: Blueprint; t: Dict }) {
  const { inputs, outputs } = classifyIO(blueprint.steps);
  const humanChecks = blueprint.steps.filter((s) => s.type === "human_review");

  if (blueprint.steps.length === 0) {
    return <p className="text-sm text-text-muted">{t.planEmptySteps}</p>;
  }

  return (
    <div className="flex flex-col gap-4 pb-2" data-testid="solution-plan-view">
      <p className="text-xs text-text-muted">{t.planIntro}</p>

      {blueprint.goal && (
        <p className="text-sm leading-relaxed text-text-secondary">
          <span className="font-medium text-text-strong">{t.wsBlueprintGoal}:</span>{" "}
          {blueprint.goal}
        </p>
      )}

      {inputs.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t.planInputsTitle}
          </h3>
          <ul className="flex flex-col gap-1.5 text-sm text-text-secondary">
            {inputs.map((s) => (
              <li key={s.id}>· {s.name}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t.planStepsTitle}
        </h3>
        <ol className="flex flex-col gap-2">
          {blueprint.steps.map((step, index) => (
            <StepCard key={step.id} step={step} index={index} t={t} />
          ))}
        </ol>
      </section>

      {outputs.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t.planOutputsTitle}
          </h3>
          <ul className="flex flex-col gap-1.5 text-sm text-text-secondary">
            {outputs.map((s) => (
              <li key={s.id}>· {s.name}</li>
            ))}
          </ul>
        </section>
      )}

      {humanChecks.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t.planHumanChecksTitle}
          </h3>
          <ul className="flex flex-col gap-1.5 text-sm text-text-secondary">
            {humanChecks.map((s) => (
              <li key={s.id}>· {s.name}{s.description ? ` — ${s.description}` : ""}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
