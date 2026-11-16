import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getI18n } from "@/lib/i18n";
import { getSessionForUser } from "@/lib/session-access";
import { CASE_STRINGS } from "@/lib/case-strings";
import { CaseWorkflow } from "@/components/case-workflow";
import { SessionBar } from "@/components/session-bar";

/** The generated solution in use: cases run through the solution's own process. */
export default async function CasesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const { locale, t } = await getI18n();
  const session = user ? await getSessionForUser(id, user.email) : undefined;
  if (!session) notFound();
  const s = CASE_STRINGS[locale];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The page's heading is the session, and leads back to it. */}
      <SessionBar
        title={
          <Link
            href={`/sessions/${id}?tab=poc`}
            className="rounded-sm transition-colors hover:text-brand-text"
          >
            {session.title}
          </Link>
        }
      />
      <main id="main-content" className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
          <CaseWorkflow
            sessionId={id}
            strings={s}
            dateLocale={locale === "fi" ? "fi-FI" : "en-GB"}
            busyMessage={t.pocRunBusy}
          />
        </div>
      </main>
    </div>
  );
}
