import type { Dict } from "@/lib/i18n";
import type { Assumption, BusinessContext } from "@/lib/sessions";
import { approve, reject, requestChanges } from "@/app/sessions/[id]/actions";

// Focus view for Gate 1: a summary of the requirements gathered in steps 1–3
// and the approve action that locks them and moves on to the design phase.
// The gathered answers come from the live agent (#29); here the checklist is
// shown as fully answered against the V1 Section-9 model. The business-context
// card surfaces the framing the agent gathered into the draft blueprint
// (current process / expected value / knowledge processes) so the SME reviews
// the business intent, not just JSON — and approval is blocked until the
// wizard has captured at least the current process.
export function Gate1Review({
  sessionId,
  points,
  answers,
  businessContext,
  assumptions = [],
  t,
}: {
  sessionId: string;
  points: string[];
  answers: string[];
  businessContext?: BusinessContext | null;
  assumptions?: Assumption[];
  t: Dict;
}) {
  const confirmedCount = assumptions.filter((a) => a.status === "confirmed").length;
  const items = points;
  const answered = answers.length;
  const pct = Math.round((answered / items.length) * 100);
  const bc = businessContext ?? null;
  // Gate 1 is only approvable once the wizard has captured the core business
  // framing — at minimum the current process and the expected value. Missing
  // pieces are named in the hint so the SME knows what to keep answering.
  const missing: string[] = [];
  if (!bc?.currentProcess) missing.push(t.bcCurrentProcess);
  if (!bc?.expectedValue.length) missing.push(t.bcExpectedValue);
  const incomplete = missing.length > 0;

  return (
    <div className="mx-auto w-full max-w-2xl py-2">
      <div className="text-center">
        <span className="section-kicker text-gold">Gate 1</span>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-text">
          {t.gate1Title}
        </h2>
        <p className="mx-auto mt-2 max-w-prose text-sm text-text-muted">
          {t.gate1Intro}
        </p>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-text">
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

      {bc && (
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold text-text">{t.bcTitle}</span>
            {bc.domain && (
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-text-muted">
                {t.bcDomain}: {bc.domain}
              </span>
            )}
          </div>
          <div className="space-y-3.5 px-4 py-3.5 text-sm">
            {bc.currentProcess && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {t.bcCurrentProcess}
                </div>
                <p className="mt-1 text-text">{bc.currentProcess}</p>
              </div>
            )}
            {bc.expectedValue.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {t.bcExpectedValue}
                </div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-text">
                  {bc.expectedValue.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </div>
            )}
            {bc.knowledgeProcesses.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {t.bcKnowledgeProcesses}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {bc.knowledgeProcesses.map((k, i) => (
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
            {bc.painPoints.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {t.bcPainPoints}
                </div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-text-secondary">
                  {bc.painPoints.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </div>
            )}
            {(bc.intendedUsers.length > 0 || bc.reviewers.length > 0) && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-text-secondary">
                {bc.intendedUsers.length > 0 && (
                  <span>
                    <span className="font-medium text-text-muted">
                      {t.bcUsers}:
                    </span>{" "}
                    {bc.intendedUsers.join(", ")}
                  </span>
                )}
                {bc.reviewers.length > 0 && (
                  <span>
                    <span className="font-medium text-text-muted">
                      {t.bcReviewers}:
                    </span>{" "}
                    {bc.reviewers.join(", ")}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {assumptions.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold text-text">{t.asmTitle}</span>
            <span className="text-xs font-semibold text-brand-text">
              {confirmedCount} / {assumptions.length} {t.asmConfirmedCount}
            </span>
          </div>
          <p className="px-4 pt-2.5 text-xs text-text-muted">{t.asmIntro}</p>
          <ul className="divide-y divide-border">
            {assumptions.map((a, i) => {
              const done = a.status === "confirmed";
              return (
                <li
                  key={a.id || i}
                  className="flex items-start gap-2.5 px-4 py-2.5"
                >
                  <span
                    className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      done
                        ? "bg-brand-soft text-brand-text"
                        : "bg-surface-muted text-text-muted"
                    }`}
                    aria-hidden
                  >
                    {i + 1}
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
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {incomplete && (
        <div
          role="status"
          className="mt-4 flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2.5 text-sm text-warning-text"
        >
          <span
            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning-text"
            aria-hidden
          />
          <span>
            {t.gate1MissingContext}{" "}
            <span className="font-semibold">
              {t.gate1Missing}: {missing.join(", ")}
            </span>
          </span>
        </div>
      )}

      <form action={approve} className="mt-6">
        <input type="hidden" name="id" value={sessionId} />
        <button
          type="submit"
          disabled={incomplete}
          className="btn-gold w-full justify-center py-3 text-base disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t.gate1Approve}
        </button>
      </form>
      <div className="mt-2 flex items-center justify-center gap-2">
        <form action={requestChanges}>
          <input type="hidden" name="id" value={sessionId} />
          <button type="submit" className="btn-secondary">
            {t.requestChanges}
          </button>
        </form>
        <form action={reject}>
          <input type="hidden" name="id" value={sessionId} />
          <button type="submit" className="btn-ghost">
            {t.rejectGate}
          </button>
        </form>
      </div>
    </div>
  );
}
