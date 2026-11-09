import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { getI18n, DATE_LOCALE, type Dict, type Locale } from "@/lib/i18n";
import { DeleteSessionButton } from "@/components/delete-session-button";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Tooltip } from "@/components/tooltip";
import { signOut } from "./login/actions";
import { startSession } from "./actions";
import { listSessions, PHASE_COUNT, type WizardSession } from "@/lib/sessions";
import { groupSessionsByDay, matchesSearch } from "@/lib/session-list";

function StatusBadge({ session, t }: { session: WizardSession; t: Dict }) {
  if (session.status === "done") {
    return (
      <span className="badge-success">
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
        {t.done}
      </span>
    );
  }
  return (
    <span className="badge-info">
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {t.step} {session.step}/{PHASE_COUNT}
    </span>
  );
}

function formatDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(DATE_LOCALE[locale], {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  const { locale, t } = await getI18n();
  const sessions = user ? await listSessions(user.email) : [];
  const { q: rawQuery } = await searchParams;
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery ?? "").trim().slice(0, 100);
  const shown = query ? sessions.filter((s) => matchesSearch(s.title, query)) : sessions;
  const groups = groupSessionsByDay(shown, new Date());
  const dayLabel = {
    today: t.dayToday,
    yesterday: t.dayYesterday,
    week: t.dayThisWeek,
    earlier: t.dayEarlier,
  } as const;

  return (
    <div className="min-h-screen flex flex-col bg-app">
      <header className="app-header sticky top-0 z-10">
        <span className="flex items-center gap-2 text-base font-semibold tracking-tight text-text">
          <span
            className="h-6 w-6 rounded-md bg-brand shadow-xs flex items-center justify-center text-on-brand text-xs font-bold"
            aria-hidden
          >
            G
          </span>
          {t.appName}
        </span>
        <div className="flex items-center gap-4 text-sm text-text-secondary">
          <LocaleSwitcher locale={locale} />
          <Link
            href="/privacy"
            data-testid="privacy-link"
            className="text-sm font-medium text-text-muted hover:text-text transition-colors"
          >
            {t.privacyLink}
          </Link>
          <span>{user?.email}</span>
          <span className="h-4 w-px bg-border" aria-hidden />
          <form action={signOut}>
            <button
              type="submit"
              className="text-sm font-medium text-text-muted hover:text-danger-text transition-colors"
            >
              {t.signOut}
            </button>
          </form>
        </div>
      </header>

      <main
        id="main-content"
        className="flex-1 max-w-3xl w-full mx-auto p-6 space-y-10"
      >
        <section>
          <h1 className="text-lg font-semibold tracking-tight text-text mb-1">
            {t.sessionsTitle}
          </h1>
          <p className="text-sm leading-relaxed text-text-secondary mb-4">
            {t.sessionsIntro}
          </p>
          <form
            action={startSession}
            className="flex gap-2 bg-surface border border-border rounded-lg p-3 shadow-xs"
          >
            <label htmlFor="session-title" className="sr-only">
              {t.sessionNameLabel}
            </label>
            <input
              id="session-title"
              name="title"
              type="text"
              placeholder={t.newSessionPlaceholder}
              className="input-field flex-1"
            />
            <button type="submit" className="btn-brand shrink-0">
              {t.startNew}
            </button>
          </form>
          {/* Open for someone without sessions; one click away for the rest. */}
          <details className="group mt-3 rounded-lg border border-border bg-surface px-4 py-3" open={sessions.length === 0}>
            <summary className="cursor-pointer text-sm font-medium text-text marker:text-text-muted">
              {t.guideTitle}
            </summary>
            <ol className="mt-3 space-y-2.5">
              {t.guideSteps.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm text-text-secondary">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
                    {i + 1}
                  </span>
                  <span>
                    <span className="font-medium text-text">{step.title}</span> {step.text}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-text-strong mb-3">
            {t.previousSessions} ({query ? `${shown.length}/${sessions.length}` : sessions.length})
          </h2>
          {sessions.length > 5 && (
            <form role="search" action="/" className="mb-4">
              <label htmlFor="session-search" className="sr-only">
                {t.searchSessions}
              </label>
              <input
                id="session-search"
                name="q"
                type="search"
                defaultValue={query}
                placeholder={t.searchSessionsPlaceholder}
                className="input-field w-full"
              />
            </form>
          )}
          {sessions.length === 0 ? (
            <p className="text-sm text-text-muted bg-surface border border-border rounded-lg p-6 text-center">
              {t.noSessions}
            </p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-text-muted bg-surface border border-border rounded-lg p-6 text-center">
              {t.noSearchResults.replace("{q}", query)}{" "}
              <Link href="/" className="font-medium text-brand-text underline">
                {t.clearSearch}
              </Link>
            </p>
          ) : (
            groups.map(({ day, sessions: daySessions }) => (
            <section key={day} aria-labelledby={`day-${day}`} className="mb-5 last:mb-0">
            <h3 id={`day-${day}`} className="mb-2 text-xs font-medium text-text-muted">
              {dayLabel[day]}
            </h3>
            <ul className="space-y-2.5">
              {daySessions.map((s) => (
                <li key={s.id} className="relative">
                  <Link
                    href={`/sessions/${s.id}`}
                    className="group block rounded-lg bg-surface border border-border p-4 pr-20 shadow-xs transition-all duration-150 hover:border-brand-soft-border hover:shadow-md hover:-translate-y-0.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-text-strong group-hover:text-brand-text transition-colors">
                        {s.title}
                      </span>
                      <Tooltip
                        label={
                          s.status === "done"
                            ? t.done
                            : `${t.step} ${s.step}/${PHASE_COUNT}: ${t.phases[s.step - 1]}`
                        }
                      >
                        <StatusBadge session={s} t={t} />
                      </Tooltip>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-text-muted">
                      <span>{t.phases[s.step - 1]}</span>
                      <span className="h-1 w-1 rounded-full bg-border-strong" aria-hidden />
                      <span>
                        {s.versions.length} {t.blueprintVersions}
                      </span>
                      <span className="h-1 w-1 rounded-full bg-border-strong" aria-hidden />
                      <span>
                        {t.updated} {formatDate(s.updatedAt, locale)}
                      </span>
                    </div>
                  </Link>
                  <div className="absolute right-3 top-3 flex items-center gap-0.5">
                    <Tooltip label={t.exportSessionOpen}>
                      <a
                        href={`/api/sessions/${s.id}/export`}
                        data-testid="export-session"
                        aria-label={t.exportSessionOpen}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
                      >
                        <svg
                          viewBox="0 0 16 16"
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" />
                        </svg>
                      </a>
                    </Tooltip>
                    <DeleteSessionButton
                    sessionId={s.id}
                    title={s.title}
                    labels={{
                      open: t.deleteSessionOpen,
                      title: t.deleteSessionTitle,
                      body: t.deleteSessionBody,
                      confirmLabel: t.deleteSessionConfirmLabel,
                      confirm: t.deleteSessionConfirm,
                      cancel: t.deleteSessionCancel,
                      mismatch: t.deleteSessionMismatch,
                      busy: t.deleteSessionBusy,
                      protected: t.deleteSessionProtected,
                      failed: t.deleteSessionFailed,
                    }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            </section>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
