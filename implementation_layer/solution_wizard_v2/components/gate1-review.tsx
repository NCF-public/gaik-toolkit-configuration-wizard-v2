import type { Dict } from "@/lib/i18n";
import { approve, reject, requestChanges } from "@/app/sessions/[id]/actions";

// Focus view for Gate 1: a summary of the requirements gathered in steps 1–3
// and the approve action that locks them and moves on to the design phase.
// The gathered answers come from the live agent (#29); here the checklist is
// shown as fully answered against the V1 Section-9 model.
export function Gate1Review({
  sessionId,
  answers,
  t,
}: {
  sessionId: string;
  answers: string[];
  t: Dict;
}) {
  const items = t.gate1Checklist;
  const answered = answers.length;
  const pct = Math.round((answered / items.length) * 100);

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

      <form action={approve} className="mt-6">
        <input type="hidden" name="id" value={sessionId} />
        <button
          type="submit"
          className="btn-gold w-full justify-center py-3 text-base"
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
