import type { Dict } from "@/lib/i18n";
import { RequirementAnswer } from "./requirement-answer";
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
  const answerLabels = {
    answer: t.gatheringAnswer,
    send: t.gatheringAnswerSend,
    cancel: t.gatheringAnswerCancel,
    placeholder: t.gatheringAnswerPlaceholder,
    sending: t.gatheringAnswerSending,
    sent: t.gatheringAnswerSent,
    failed: t.gatheringAnswerFailed,
    message: t.gatheringAnswerMessage,
  };

  // The live agent asks in the chat and keeps no list here (the checklist is
  // the mock store's), so with no points the view says how gathering goes.
  if (total === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <p className="max-w-prose text-sm leading-relaxed text-text-secondary">
          {t.gatheringRounds}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <p className="max-w-prose text-sm leading-relaxed text-text-secondary">
        {t.gatheringPrompt}
      </p>

      <section className="mt-5 rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
          <h4 className="text-sm font-semibold text-text">{t.gate1ChecklistTitle}</h4>
          <span className="text-xs text-text-muted">
            {answered} / {total} {t.gate1Answered}
          </span>
        </div>
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
                  {!done && <RequirementAnswer number={i + 1} question={q} labels={answerLabels} />}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
