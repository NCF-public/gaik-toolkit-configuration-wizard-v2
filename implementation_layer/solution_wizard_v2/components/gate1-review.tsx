import type { Dict } from "@/lib/i18n";
import type { Assumption, BusinessContext } from "@/lib/sessions";
import { fillTemplate, quoteOneLine } from "@/lib/chat-template";
import { ChangeInPlace } from "@/components/ask-in-chat-button";
import { Icon } from "@/components/icons";
import { known, knownList } from "@/lib/known-values";
import { plainLabel, plainLabelCapitalized, plainLabels } from "@/lib/plain-label";

/**
 * What Gate 1 still lacks before it can be approved: the wizard has to have
 * captured at least the current process and the expected value. The names go
 * into the decision bar's hint, so the SME knows what to keep answering.
 */
export function gate1Missing(businessContext: BusinessContext | null | undefined, t: Dict): string[] {
  const missing: string[] = [];
  if (!known(businessContext?.currentProcess)) missing.push(t.bcCurrentProcess);
  if (!knownList(businessContext?.expectedValue).length) missing.push(t.bcExpectedValue);
  return missing;
}

// Focus view for Gate 1: the requirements gathered in steps 1–3, the business
// framing the agent captured into the draft blueprint (current process /
// expected value / knowledge processes) and the assumptions it recorded, so the
// SME reviews the business intent, not just JSON. It reads as one document:
// plain headings on one sheet, no cards inside it, and the agent's identifiers
// ("knowledge_capture") in plain words. Each item can be corrected where it
// stands: a field opens under it, and the correction goes to the wizard as a
// chat turn. The decision itself is the page's gate decision bar.
export function Gate1Review({
  points,
  answers,
  businessContext,
  assumptions = [],
  t,
}: {
  points: string[];
  answers: string[];
  businessContext?: BusinessContext | null;
  assumptions?: Assumption[];
  t: Dict;
}) {
  const items = points;
  const answered = answers.length;
  const bc = businessContext ?? null;
  const ctx = bc && {
    domain: known(bc.domain),
    currentProcess: known(bc.currentProcess),
    expectedValue: knownList(bc.expectedValue),
    knowledgeProcesses: plainLabels(knownList(bc.knowledgeProcesses), t.bcKnowledgeProcessLabels),
    painPoints: knownList(bc.painPoints),
    intendedUsers: knownList(bc.intendedUsers),
    reviewers: knownList(bc.reviewers),
  };
  const notKnown = ctx
    ? [
        !ctx.currentProcess && t.bcCurrentProcess,
        !ctx.expectedValue.length && t.bcExpectedValue,
        !ctx.painPoints.length && t.bcPainPoints,
        !ctx.intendedUsers.length && t.bcUsers,
      ].filter((label): label is string => Boolean(label))
    : [];

  const change = {
    change: t.changeHere.change,
    field: t.changeHere.field,
    send: t.changeHere.send,
    cancel: t.changeHere.cancel,
    working: t.changeHere.working,
    failed: t.changeHere.failed,
  };
  // One item of the business context: its name, what the wizard recorded, and
  // the control that corrects it in place. The item's text is the agent's, so
  // it travels as a quote on one line.
  const field = (key: string, label: string, value: string | string[], asList = false) => {
    const values = Array.isArray(value) ? value : [value];
    return (
      <ChangeInPlace
        key={key}
        term={label}
        name={fillTemplate(t.changeHere.item, { item: label })}
        prefix={fillTemplate(t.bcPrefix, { field: label, text: quoteOneLine(values.join("; ")) })}
        labels={change}
      >
        {asList && values.length > 1 ? (
          <ul className="list-disc space-y-0.5 pl-5">
            {values.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        ) : (
          values.join(", ")
        )}
      </ChangeInPlace>
    );
  };
  const heading = "text-base font-semibold text-text";
  const section = "px-5 py-5 sm:px-7";
  const empty = items.length === 0 && !ctx && assumptions.length === 0;

  if (empty) {
    return (
      <p
        className="mx-auto w-full max-w-3xl py-10 text-center text-sm text-text-muted"
        data-testid="gate1-review-empty"
      >
        {t.gate1ReviewEmpty}
      </p>
    );
  }

  return (
    <article
      className="mx-auto my-2 w-full max-w-3xl divide-y divide-border rounded-xl border border-border bg-surface"
      data-testid="gate1-review"
    >
      {/* The live agent keeps no requirement list (it is the mock store's):
          without points the gathered model below is the review. */}
      {items.length > 0 && (
        <section className={section}>
          <h2 className={heading}>{t.gate1ChecklistTitle}</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            {answered} / {items.length} {t.gate1Answered}
          </p>
          <ul className="mt-3 space-y-2.5">
            {items.map((q, i) => {
              const done = i < answered;
              return (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <Icon
                    name={done ? "check" : "circle"}
                    size={15}
                    className={`mt-0.5 shrink-0 ${done ? "text-brand-text" : "text-border-strong"}`}
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className={`block ${done ? "text-text" : "text-text-muted"}`}>{q}</span>
                    {done && answers[i] && (
                      <span className="mt-0.5 block text-text-secondary">{answers[i]}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {ctx && (
        <section className={section}>
          <h2 className={heading}>{t.bcTitle}</h2>
          {ctx.domain && (
            <p className="mt-0.5 text-sm text-text-muted [overflow-wrap:anywhere]">
              {t.bcDomain}: {plainLabelCapitalized(ctx.domain)}
            </p>
          )}
          <dl className="mt-4 space-y-4">
            {ctx.currentProcess && field("currentProcess", t.bcCurrentProcess, ctx.currentProcess)}
            {ctx.expectedValue.length > 0 &&
              field("expectedValue", t.bcExpectedValue, ctx.expectedValue, true)}
            {ctx.knowledgeProcesses.length > 0 &&
              field(
                "knowledgeProcesses",
                t.bcKnowledgeProcesses,
                // One line of words: the first one starts the line.
                ctx.knowledgeProcesses.map((k, i) =>
                  i === 0 ? k.charAt(0).toLocaleUpperCase() + k.slice(1) : k,
                ),
              )}
            {ctx.painPoints.length > 0 && field("painPoints", t.bcPainPoints, ctx.painPoints, true)}
            {ctx.intendedUsers.length > 0 && field("intendedUsers", t.bcUsers, ctx.intendedUsers)}
            {ctx.reviewers.length > 0 && field("reviewers", t.bcReviewers, ctx.reviewers)}
          </dl>
          {notKnown.length > 0 && (
            <p className="mt-4 flex items-start gap-1.5 text-sm text-text-muted" data-testid="bc-not-known">
              <Icon name="info" size={15} className="mt-0.5 shrink-0" />
              <span>
                {t.bcNotKnown}: {notKnown.join(", ")}
              </span>
            </p>
          )}
        </section>
      )}

      {assumptions.length > 0 && (
        <section className={section}>
          <h2 className={heading}>{t.asmTitle}</h2>
          <p className="mt-0.5 text-sm text-text-muted">{t.asmIntro}</p>
          <ol className="mt-3 divide-y divide-border" data-testid="gate1-assumptions">
            {assumptions.map((a, i) => {
              const done = a.status === "confirmed";
              const n = String(i + 1);
              const chip = fillTemplate(t.asmChip, { n });
              return (
                <li key={a.id || i} className="py-3 text-sm last:pb-0">
                  <ChangeInPlace
                    name={fillTemplate(t.changeHere.item, { item: chip })}
                    prefix={fillTemplate(t.asmPrefix, { n, text: quoteOneLine(a.text) })}
                    labels={change}
                    // Under the assumption's text, past its number.
                    formClassName="pl-7"
                  >
                    <span className="w-4 shrink-0 text-right tabular-nums text-text-muted" aria-hidden>
                      {n}.
                    </span>
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                      <span className="block text-text">{a.text}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                        {/* The row's one status. */}
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            done ? "text-text-muted" : "text-warning-text"
                          }`}
                          data-testid="assumption-status"
                        >
                          <Icon name={done ? "check" : "circleDot"} size={13} />
                          {done ? t.asmConfirmed : t.asmUnconfirmed}
                        </span>
                        {a.impact && (
                          <span className="text-text-muted">
                            {fillTemplate(t.asmImpact, { impact: plainLabel(a.impact, t.asmImpactLabels) })}
                          </span>
                        )}
                      </span>
                    </span>
                  </ChangeInPlace>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </article>
  );
}
