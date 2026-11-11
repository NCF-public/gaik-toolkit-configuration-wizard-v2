import type { ReactNode } from "react";
import type { Dict } from "@/lib/i18n";
import type { Assumption, BusinessContext } from "@/lib/sessions";
import type { ChatReference } from "@/lib/chat-events";
import { fillTemplate, quoteOneLine } from "@/lib/chat-template";
import { AskInChatButton } from "@/components/ask-in-chat-button";
import { Icon } from "@/components/icons";
import { known, knownList } from "@/lib/known-values";

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
// SME reviews the business intent, not just JSON. Each item can be taken to
// the chat to be changed. The decision itself is the page's gate decision bar.
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
  const confirmedCount = assumptions.filter((a) => a.status === "confirmed").length;
  const items = points;
  const answered = answers.length;
  const pct = items.length ? Math.round((answered / items.length) * 100) : 0;
  const bc = businessContext ?? null;
  const ctx = bc && {
    domain: known(bc.domain),
    currentProcess: known(bc.currentProcess),
    expectedValue: knownList(bc.expectedValue),
    knowledgeProcesses: knownList(bc.knowledgeProcesses),
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

  // "Change in the chat" beside one business-context item: the item's text is
  // the agent's, so it travels as a quote on one line.
  const askBc = (key: string, field: string, value: string | string[]) => {
    const text = Array.isArray(value) ? value.join("; ") : value;
    const reference: ChatReference = {
      key: `bc:${key}`,
      label: field,
      prefix: fillTemplate(t.bcPrefix, { field, text: quoteOneLine(text) }),
    };
    return (
      <AskInChatButton
        reference={reference}
        label={fillTemplate(t.askInChatItem, { item: field })}
        title={t.askInChat}
      />
    );
  };
  const fieldHead = (label: string, button: ReactNode) => (
    <div className="flex items-center justify-between gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      {button}
    </div>
  );

  return (
    <div className="@container mx-auto w-full max-w-5xl py-2">
      {/* The live agent keeps no requirement list (it is the mock store's):
          without points the gathered model below is the review, not "0 / 0". */}
      <div className="grid gap-4 @2xl:grid-cols-2 @2xl:items-start">
      {items.length > 0 && (
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm @2xl:col-span-2">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon name="listChecks" size={16} className="text-text-muted" />
            {t.gate1ChecklistTitle}
          </span>
          <span className="text-xs font-semibold text-brand-text">
            {answered} / {items.length} {t.gate1Answered}
          </span>
        </div>
        <div
          className="h-1.5 bg-surface-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span
            className="block h-full bg-gradient-to-r from-brand to-brand-strong"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ul className="divide-y divide-border">
          {items.map((q, i) => {
            const done = i < answered;
            return (
              <li key={i} className="flex items-start gap-2.5 px-4 py-2.5">
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    done
                      ? "bg-brand-soft text-brand-text"
                      : "border border-border-strong"
                  }`}
                  aria-hidden
                >
                  {done ? "✓" : ""}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-sm ${done ? "text-text" : "text-text-muted"}`}
                  >
                    {q}
                  </span>
                  {done && answers[i] && (
                    <span className="mt-1.5 inline-flex max-w-full items-start gap-1.5 rounded-md border border-brand-soft-border bg-brand-soft px-2 py-1 text-xs font-medium text-brand-text">
                      <span aria-hidden className="mt-px shrink-0">
                        ↳
                      </span>
                      <span className="min-w-0 break-words">{answers[i]}</span>
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      )}

      {ctx && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-text">
              <Icon name="workflow" size={16} className="text-text-muted" />
              {t.bcTitle}
            </span>
            {ctx.domain && (
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-text-muted">
                {t.bcDomain}: {ctx.domain}
              </span>
            )}
          </div>
          <div className="space-y-3.5 px-4 py-3.5 text-sm">
            {ctx.currentProcess && (
              <div className="group/item">
                {fieldHead(t.bcCurrentProcess, askBc("currentProcess", t.bcCurrentProcess, ctx.currentProcess))}
                <p className="mt-1 text-text">{ctx.currentProcess}</p>
              </div>
            )}
            {ctx.expectedValue.length > 0 && (
              <div className="group/item">
                {fieldHead(t.bcExpectedValue, askBc("expectedValue", t.bcExpectedValue, ctx.expectedValue))}
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-text">
                  {ctx.expectedValue.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </div>
            )}
            {ctx.knowledgeProcesses.length > 0 && (
              <div className="group/item">
                {fieldHead(
                  t.bcKnowledgeProcesses,
                  askBc("knowledgeProcesses", t.bcKnowledgeProcesses, ctx.knowledgeProcesses),
                )}
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {ctx.knowledgeProcesses.map((k, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-text"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {ctx.painPoints.length > 0 && (
              <div className="group/item">
                {fieldHead(t.bcPainPoints, askBc("painPoints", t.bcPainPoints, ctx.painPoints))}
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-text-secondary">
                  {ctx.painPoints.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </div>
            )}
            {ctx.intendedUsers.length > 0 && (
              <div className="group/item flex items-start justify-between gap-2 text-text-secondary">
                <span>
                  <span className="font-medium text-text-muted">{t.bcUsers}:</span>{" "}
                  {ctx.intendedUsers.join(", ")}
                </span>
                {askBc("intendedUsers", t.bcUsers, ctx.intendedUsers)}
              </div>
            )}
            {ctx.reviewers.length > 0 && (
              <div className="group/item flex items-start justify-between gap-2 text-text-secondary">
                <span>
                  <span className="font-medium text-text-muted">{t.bcReviewers}:</span>{" "}
                  {ctx.reviewers.join(", ")}
                </span>
                {askBc("reviewers", t.bcReviewers, ctx.reviewers)}
              </div>
            )}
            {notKnown.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-text-muted" data-testid="bc-not-known">
                <Icon name="info" size={14} className="mt-px shrink-0" />
                <span>
                  {t.bcNotKnown}: {notKnown.join(", ")}
                </span>
              </p>
            )}
          </div>
        </div>
      )}
      {assumptions.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-text">
              <Icon name="flag" size={16} className="text-text-muted" />
              {t.asmTitle}
            </span>
            <span className="text-xs font-semibold text-brand-text">
              {confirmedCount} / {assumptions.length} {t.asmConfirmedCount}
            </span>
          </div>
          <p className="px-4 pt-2.5 text-xs text-text-muted">{t.asmIntro}</p>
          <ul className="divide-y divide-border">
            {assumptions.map((a, i) => {
              const done = a.status === "confirmed";
              const n = String(i + 1);
              const chip = fillTemplate(t.asmChip, { n });
              return (
                <li
                  key={a.id || i}
                  className="group/item flex items-start gap-2.5 px-4 py-2.5"
                >
                  <span
                    className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      done
                        ? "bg-brand-soft text-brand-text"
                        : "bg-surface-muted text-text-muted"
                    }`}
                    aria-hidden
                  >
                    {n}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-text">{a.text}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {a.impact && (
                        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-text-muted">
                          {t.asmImpact}: {a.impact}
                        </span>
                      )}
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                          done
                            ? "border-brand-soft-border bg-brand-soft text-brand-text"
                            : "border-warning-border bg-warning-bg text-warning-text"
                        }`}
                      >
                        {done ? t.asmConfirmed : t.asmUnconfirmed}
                      </span>
                    </span>
                  </span>
                  <AskInChatButton
                    reference={{
                      key: `assumption:${a.id || n}`,
                      label: chip,
                      prefix: fillTemplate(t.asmPrefix, { n, text: quoteOneLine(a.text) }),
                    }}
                    label={fillTemplate(t.askInChatItem, { item: chip })}
                    title={t.askInChat}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      </div>
    </div>
  );
}
