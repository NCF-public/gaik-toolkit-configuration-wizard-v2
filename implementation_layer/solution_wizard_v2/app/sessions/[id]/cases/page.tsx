import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getI18n } from "@/lib/i18n";
import { getSessionForUser } from "@/lib/session-access";
import { CASE_STRINGS } from "@/lib/case-strings";
import { AppHeader } from "@/components/app-header";
import { CaseWorkflow } from "@/components/case-workflow";

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
        {/* The logo already leads to the sessions; the crumb is this session. */}
        <h1 className="min-w-0 truncate text-sm font-semibold text-text">
          <Link href={`/sessions/${id}?tab=poc`} className="rounded-sm transition-colors hover:text-brand-text">
            {session.title}
          </Link>
        </h1>
      </AppHeader>
      <main id="main-content" className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-5">
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
