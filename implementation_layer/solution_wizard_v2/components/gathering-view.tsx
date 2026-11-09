import type { Dict } from "@/lib/i18n";
import { Icon } from "./icons";

// Gathering-phase center view (steps 1–3). No technical blueprint yet — that
// belongs to the design phase (step 5+). The session starts in the chat, open
// beside (or over) this view; here the requirements checklist fills up from
// the answers.
export function GatheringView({
  points,
  answers,
  t,
}: {
  points: string[];
  answers: string[];
  t: Dict;
}) {
  const items = points;
  const total = items.length;
  const answered = answers.length;
  const pct = total ? Math.round((answered / total) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <p className="max-w-prose text-sm leading-relaxed text-text-secondary">
        {t.gatheringPrompt}
      </p>

      <section className="mt-5 rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
          <h4 className="text-sm font-semibold text-text">{t.gate1ChecklistTitle}</h4>
          {total > 0 && (
            <span className="text-xs text-text-muted">
              {answered} / {total} {t.gate1Answered}
            </span>
          )}
        </div>
        {total === 0 ? (
          // Before the wizard's first questions there is nothing to count.
          <p className="px-4 pb-1 text-sm text-text-muted">{t.gatheringEmpty}</p>
        ) : (
          <div
            className="mx-4 h-1 overflow-hidden rounded-full bg-surface-muted"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t.gate1ChecklistTitle}
          >
            <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
        )}
        <ul className="mt-2 divide-y divide-border">
          {items.map((q, i) => {
            const done = i < answered;
            return (
              <li key={i} className="flex items-start gap-2.5 px-4 py-2.5">
                {done ? (
                  <Icon name="circleCheck" size={16} className="mt-0.5 text-brand-strong" />
                ) : (
                  <Icon name="circle" size={16} className="mt-0.5 text-border-strong" />
                )}
                <span className="min-w-0">
                  <span className={`block text-sm ${done ? "text-text" : "text-text-muted"}`}>
                    {q}
                  </span>
                  {done && answers[i] && (
                    <span className="mt-0.5 block break-words text-xs text-text-secondary">
                      {answers[i]}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
