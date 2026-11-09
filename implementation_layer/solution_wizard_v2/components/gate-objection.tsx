import type { Dict } from "@/lib/i18n";
import { reject, requestChanges } from "@/app/sessions/[id]/actions";
import { Icon } from "@/components/icons";

// The two ways a reviewer says "not yet" at a gate — both carrying a reason.
//
// The reason is not optional: the agent revises the artifacts from it, and
// `MessageAppend` refuses an empty `user_content`, so a reason-less objection
// used to drop the acknowledgement silently and leave nothing visible in the
// chat (#126). `required` on the textarea covers both submit buttons natively,
// which keeps this a server component — no client JS for a two-field form.
//
// Collapsed by default so the gate leads with its approve action; opening it
// grows the container rather than overlaying anything.
export function GateObjection({
  sessionId,
  t,
  className = "",
}: {
  sessionId: string;
  t: Dict;
  className?: string;
}) {
  const fieldId = `gate-feedback-${sessionId}`;
  return (
    <details className={`group ${className}`}>
      <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-text-muted hover:text-text">
        <Icon name="messageSquareText" size={16} />
        {t.gate1FeedbackSummary}
        <Icon name="chevronDown" size={14} className="transition-transform group-open:rotate-180" />
      </summary>
      <form className="mt-3 space-y-2">
        <input type="hidden" name="id" value={sessionId} />
        <label htmlFor={fieldId} className="block text-xs font-semibold text-text">
          {t.gate1FeedbackLabel}
        </label>
        <p className="text-xs text-text-muted">{t.gate1FeedbackHow}</p>
        <textarea
          id={fieldId}
          name="feedback"
          required
          rows={3}
          placeholder={t.gate1FeedbackPlaceholder}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-brand-soft-border focus:outline-none"
        />
        <div className="flex items-center justify-center gap-2">
          <button type="submit" formAction={requestChanges} className="btn-secondary">
            {t.requestChanges}
          </button>
          <button type="submit" formAction={reject} className="btn-ghost">
            {t.rejectGate}
          </button>
        </div>
      </form>
    </details>
  );
}
