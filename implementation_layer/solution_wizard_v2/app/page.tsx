import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { getI18n, DATE_LOCALE, type Dict, type Locale } from "@/lib/i18n";
import { AppHeader } from "@/components/app-header";
import { DeleteSessionButton } from "@/components/delete-session-button";
import { Icon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { startSession } from "./actions";
import { listSessions, PHASE_COUNT, type WizardSession } from "@/lib/sessions";
import { fillQuery, groupSessionsByDay, matchesSearch, showsSearch } from "@/lib/session-list";

function StatusBadge({ session, t }: { session: WizardSession; t: Dict }) {
  if (session.status === "done") {
    return (
      <span className="badge-success shrink-0 whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
        {t.done}
      </span>
    );
  }
  return (
    <span className="badge-info shrink-0 whitespace-nowrap">
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
  const typedQuery = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery ?? "").trim().slice(0, 100);
  // The field and the filter go together: a search in the address keeps the
  // field on the page, and without the field nothing is filtered.
  const searchShown = showsSearch(sessions.length, typedQuery);
  const query = searchShown ? typedQuery : "";
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
      <AppHeader locale={locale} t={t} email={user?.email} privacyLink />

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
            className="flex flex-col gap-2 bg-surface border border-border rounded-lg p-3 shadow-xs sm:flex-row"
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
          {searchShown && (
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
              {fillQuery(t.noSearchResults, query)}{" "}
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
                    // The row lifts as a whole on hover, so the card and its
                    // two corner buttons move together.
                    <li
                      key={s.id}
                      className="group/card relative transition-transform duration-150 ease-out hover:z-10 hover:-translate-y-0.5 focus-within:z-10 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                    >
                      <Link
                        href={`/sessions/${s.id}`}
                        data-testid="session-card"
                        className="block rounded-lg border border-border bg-surface p-4 shadow-xs transition-[border-color,box-shadow] duration-150 ease-out group-hover/card:border-brand-soft-border group-hover/card:shadow-md"
                      >
                        {/* The title has the card's width; only the corner
                            buttons are kept clear. */}
                        <span className="block break-words pr-[4.5rem] text-sm font-semibold text-text-strong transition-colors group-hover/card:text-brand-text">
                          {s.title}
                        </span>
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                          <StatusBadge session={s} t={t} />
                          <span>{t.phases[s.step - 1]}</span>
                          {/* On a phone the date takes its own line, so no dot
                              is left hanging at the end of a wrapped row. */}
                          <span className="hidden h-1 w-1 rounded-full bg-border-strong sm:block" aria-hidden />
                          <span className="basis-full sm:basis-auto">
                            {t.updated} {formatDate(s.updatedAt, locale)}
                          </span>
                        </div>
                      </Link>
                      <div className="absolute right-2.5 top-2.5 flex items-center gap-0.5">
                        <Tooltip label={t.exportSessionOpen}>
                          <a
                            href={`/api/sessions/${s.id}/export`}
                            data-testid="export-session"
                            aria-label={`${t.exportSessionOpen}: ${s.title}`}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
                          >
                            <Icon name="download" size={16} />
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
