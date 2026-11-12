import { getCurrentUser } from "@/lib/current-user";
import { getI18n, DATE_LOCALE, type Dict } from "@/lib/i18n";
import { AppHeader } from "@/components/app-header";
import { GateTrack } from "@/components/gate-track";
import { Icon } from "@/components/icons";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { SessionList, type SessionRow } from "@/components/session-list";
import { startSession } from "./actions";
import { GATE_STEPS, listSessions, PHASE_COUNT } from "@/lib/sessions";
import {
  formatUpdated,
  formatUpdatedFull,
  gateMarks,
  groupSessionsByDay,
  standing,
  type GateMark,
} from "@/lib/session-list";

/** The four checkpoints of a session, each beside its place on a row's track. */
function Guide({ t }: { t: Dict }) {
  return (
    <ol className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
      {t.guideSteps.map((step, i) => (
        <li key={i} className="text-sm leading-relaxed text-text-secondary">
          <span className="flex items-center gap-2.5 font-medium text-text">
            <GateTrack
              marks={t.guideSteps.map((_, gate): GateMark => (gate <= i ? "approved" : "ahead"))}
            />
            {step.title}
          </span>
          <span className="mt-1 block">{step.text}</span>
        </li>
      ))}
    </ol>
  );
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

  // Every text of a row is made here, in the user's language and in Finland's
  // time, so the list in the browser shows exactly what the server rendered.
  const rows: SessionRow[] = groupSessionsByDay(sessions, new Date()).flatMap(
    ({ day, sessions: daySessions }) =>
      daySessions.map((s) => {
        const marks = gateMarks(s.step, GATE_STEPS, s.gateStatus);
        const where = standing(marks);
        return {
          id: s.id,
          title: s.title,
          day,
          marks,
          standing: where,
          stepLabel: `${t.step} ${s.step}/${PHASE_COUNT}`,
          phase: where === "done" ? "" : (t.phases[s.step - 1] ?? ""),
          updatedIso: s.updatedAt,
          updated: formatUpdated(s.updatedAt, day, DATE_LOCALE[locale]),
          updatedFull: `${t.updated} ${formatUpdatedFull(s.updatedAt, DATE_LOCALE[locale])}`,
        };
      }),
  );

  return (
    <div className="flex min-h-screen flex-col bg-app">
      <AppHeader locale={locale} t={t} email={user?.email} privacyLink />

      <main
        id="main-content"
        className="mx-auto w-full max-w-3xl flex-1 px-4 pb-20 pt-10 sm:px-6 sm:pt-14"
      >
        <h1 className="text-2xl font-semibold tracking-tight text-text-strong">
          {t.sessionsTitle}
        </h1>

        <form
          action={startSession}
          className="new-session mt-5 flex flex-col gap-1.5 rounded-xl border border-border-strong bg-surface p-1.5 shadow-sm sm:flex-row sm:items-center"
        >
          <label htmlFor="session-title" className="sr-only">
            {t.sessionNameLabel}
          </label>
          <input
            id="session-title"
            name="title"
            type="text"
            placeholder={t.newSessionPlaceholder}
            className="focus-in-box min-w-0 flex-1 rounded-lg bg-transparent px-3 py-2 text-[15px] text-text outline-none placeholder:text-text-muted"
          />
          <PendingSubmitButton
            label={t.startNew}
            pendingLabel={t.startNew}
            className="btn-brand shrink-0 rounded-lg"
          />
        </form>

        {sessions.length === 0 ? (
          <section aria-labelledby="guide-title" className="mt-12">
            <h2 id="guide-title" className="mb-4 text-sm font-semibold text-text-strong">
              {t.guideTitle}
            </h2>
            <Guide t={t} />
          </section>
        ) : (
          <>
            <details className="group mt-3">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md py-1 pr-2 text-sm text-text-muted transition-colors hover:text-text [&::-webkit-details-marker]:hidden">
                <Icon
                  name="chevronRight"
                  size={14}
                  className="transition-transform duration-150 ease-out group-open:rotate-90"
                />
                {t.guideTitle}
              </summary>
              <div className="pb-2 pl-[1.125rem] pt-3">
                <Guide t={t} />
              </div>
            </details>

            <div className="mt-10">
              <SessionList
                rows={rows}
                initialQuery={query}
                labels={{
                  days: {
                    today: t.dayToday,
                    yesterday: t.dayYesterday,
                    week: t.dayThisWeek,
                    earlier: t.dayEarlier,
                  },
                  search: t.searchSessions,
                  searchPlaceholder: t.searchSessionsPlaceholder,
                  noResults: t.noSearchResults,
                  clearSearch: t.clearSearch,
                  done: t.done,
                  waiting: t.gates.pending,
                  rejected: t.gates.rejected,
                  updated: t.updated,
                  exportOpen: t.exportSessionOpen,
                  remove: {
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
                  },
                }}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
