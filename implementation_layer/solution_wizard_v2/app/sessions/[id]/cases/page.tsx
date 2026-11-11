import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getI18n } from "@/lib/i18n";
import { getSessionForUser } from "@/lib/session-access";
import { CASE_STRINGS } from "@/lib/case-strings";
import { AppHeader } from "@/components/app-header";
import { CaseWorkflow } from "@/components/case-workflow";
import { Icon } from "@/components/icons";

/** The generated solution in use: cases run through the solution's own process. */
export default async function CasesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const { locale, t } = await getI18n();
  const session = user ? await getSessionForUser(id, user.email) : undefined;
  if (!session) notFound();
  const s = CASE_STRINGS[locale];

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader locale={locale} t={t} email={user?.email}>
        <Link
          href="/"
          className="hidden shrink-0 text-sm text-text-muted transition-colors hover:text-text md:inline"
        >
          {t.backToSessions}
        </Link>
        <Icon name="chevronRight" size={14} className="hidden text-text-muted md:block" />
        <h1 className="truncate text-sm font-semibold text-text">{session.title}</h1>
      </AppHeader>
      <main id="main-content" className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-5">
        {/* The way back to the wizard, where it is looked for: above the page. */}
        <Link
          href={`/sessions/${id}?tab=poc`}
          className="mb-4 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-text-secondary transition-colors hover:text-brand-text"
        >
          <Icon name="arrowLeft" size={16} />
          {s.back}
        </Link>
        <CaseWorkflow
          sessionId={id}
          strings={s}
          dateLocale={locale === "fi" ? "fi-FI" : "en-GB"}
          busyMessage={t.pocRunBusy}
        />
      </main>
      <span className="sr-only">{t.appName}</span>
    </div>
  );
}
