import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getI18n } from "@/lib/i18n";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { signOut } from "@/app/login/actions";
import { ChatDock } from "@/components/chat-dock";
import { WorkspacePanel } from "@/components/workspace-panel";
import { GateTimeline } from "@/components/gate-timeline";
import { advance, regress, approve } from "./actions";
import { getSessionForUser } from "@/lib/session-access";
import {
  PHASE_COUNT,
  isGateStep,
} from "@/lib/sessions";
import { shouldCollapseChatByDefault } from "@/lib/bpmn-spike";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const { locale, t } = await getI18n();
  const session = user ? await getSessionForUser(id, user.email) : undefined;

  if (!session) notFound();

  const currentPhase = t.phases[session.step - 1];
  const onGate = isGateStep(session.step);
  const gatePending = onGate && session.gateStatus[session.step] === "pending";
  const atEnd = session.step >= PHASE_COUNT;

  const gateSteps = Array.from({ length: PHASE_COUNT }, (_, i) => i + 1).filter(
    isGateStep,
  );

  return (
    <div className="h-screen flex flex-col">
      <header className="h-14 shrink-0 px-5 flex items-center justify-between bg-surface/80 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-3.5 min-w-0">
          <span className="flex items-center gap-2.5 shrink-0" aria-hidden>
            <span className="relative flex h-8 w-8 items-center justify-center drop-shadow-[0_1px_2px_rgba(17,27,40,0.18)]">
              <span className="hex absolute inset-0 bg-logo-gradient" />
              <span className="hex absolute inset-0.5 bg-surface" />
              <span className="relative z-[1] font-display text-sm font-extrabold text-brand-strong">
                G
              </span>
            </span>
            <span className="text-base font-bold tracking-tight text-text">
              GAIK <span className="font-medium text-text-muted">Wizard</span>
            </span>
          </span>
          <span className="h-4 w-px bg-border-strong" aria-hidden />
          <Link
            href="/"
            className="text-sm text-text-muted hover:text-brand-strong transition-colors shrink-0"
          >
            {t.backToSessions}
          </Link>
          <span className="h-4 w-px bg-border-strong" aria-hidden />
          <h1 className="text-base font-semibold tracking-tight text-text truncate">
            {session.title}
          </h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-text-secondary">
          <LocaleSwitcher locale={locale} />
          <span className="text-text-muted">{user?.email}</span>
          <span className="h-4 w-px bg-border-strong" aria-hidden />
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

      <div className="flex flex-1 min-h-0">
        <GateTimeline
          locale={locale}
          step={session.step}
          phases={t.phases}
          gateSteps={gateSteps}
          gateStatus={session.gateStatus}
          phaseCount={PHASE_COUNT}
        />

        <main
          id="main-content"
          className="relative overflow-hidden flex-1 flex flex-col min-w-0 min-h-0"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute right-[-40px] top-1/2 z-0 flex h-[420px] w-[var(--width-chat)] -translate-y-1/2 items-center justify-center text-[200px] font-extrabold italic text-[rgba(17,27,40,0.045)]"
          >
            <span className="hex absolute inset-0 bg-[rgba(17,27,40,0.03)]" />
            G
          </div>

          <div className="relative z-10 shrink-0 flex items-center justify-between px-6 py-3.5 border-b border-border">
            <div className="flex items-baseline gap-3">
              <span className="section-kicker">{t.workspace}</span>
              <h2 className="text-xl font-bold tracking-tight text-text">
                {currentPhase}
              </h2>
            </div>
            <span className="text-xs text-text-muted">
              {t.activeBlueprint} v{session.activeVersion} ·{" "}
              {session.versions.length} {t.versions}
            </span>
          </div>

          <div className="relative z-10 flex-1 min-h-0 overflow-y-auto flex flex-col p-6">
            {gatePending && (
              <div
                role="status"
                className="shrink-0 mb-4 rounded-md border border-warning-border bg-warning-bg px-3 py-2.5 text-sm text-warning-text flex items-start gap-2"
              >
                <span
                  className="h-1.5 w-1.5 mt-1.5 rounded-full bg-warning-text shrink-0"
                  aria-hidden
                />
                <span>{t.gateNotice}</span>
              </div>
            )}

            <WorkspacePanel
              sessionId={session.id}
              sessionTitle={session.title}
              wizardStep={session.step}
              blueprint={session.blueprint}
              t={t}
            />
          </div>

          <div className="relative z-10 shrink-0 flex items-center justify-between px-6 py-3.5 border-t border-border">
            <form action={regress}>
              <input type="hidden" name="id" value={session.id} />
              <button type="submit" disabled={session.step <= 1} className="btn-ghost">
                {t.previous}
              </button>
            </form>

            {gatePending ? (
              <form action={approve}>
                <input type="hidden" name="id" value={session.id} />
                <button type="submit" className="btn-gold">
                  {t.approveGate}
                </button>
              </form>
            ) : (
              <form action={advance}>
                <input type="hidden" name="id" value={session.id} />
                <button type="submit" disabled={atEnd} className="btn-brand">
                  {atEnd ? t.ready : t.nextPhase}
                </button>
              </form>
            )}
          </div>
        </main>

        <ChatDock
          sessionId={session.id}
          initialMessages={session.messages}
          chatTitle={t.chat}
          greeting={t.chatGreeting}
          inputPlaceholder={t.chatInputPlaceholder}
          inputLabel={t.chatInputLabel}
          sendLabel={t.chatSend}
          streamFailedLabel={t.streamFailed}
          hideChatLabel={t.hideChat}
          showChatLabel={t.showChat}
          railBadge={`${t.phaseUpper} ${session.step}`}
          userInitial={(user?.email?.[0] ?? "K").toUpperCase()}
          defaultOpen={!shouldCollapseChatByDefault(session.step)}
        />
      </div>
    </div>
  );
}
