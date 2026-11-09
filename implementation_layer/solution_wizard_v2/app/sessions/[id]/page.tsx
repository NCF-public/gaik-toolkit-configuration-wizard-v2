import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getI18n } from "@/lib/i18n";
import { AppHeader } from "@/components/app-header";
import { ChatDock, OpenChatButton } from "@/components/chat-dock";
import { Icon } from "@/components/icons";
import { WorkspacePanel } from "@/components/workspace-panel";
import { GateTimeline } from "@/components/gate-timeline";
import { Gate1Review } from "@/components/gate1-review";
import { GateObjection } from "@/components/gate-objection";
import { GatheringView } from "@/components/gathering-view";
import { GatheringAdvanceButton } from "@/components/gathering-advance-button";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { FieldSchemaEditor } from "@/components/field-schema-editor";
import { fieldSpecsFromTargetOutput } from "@/lib/target-output-spec";
import { advance, regress, approve } from "./actions";
import { getSessionForUser } from "@/lib/session-access";
import {
  PHASE_COUNT,
  isGateStep,
} from "@/lib/sessions";
import { POC_STEP } from "@/lib/mock-sessions";
import { shouldCollapseChatByDefault } from "@/lib/bpmn-spike";
import { crossesPassedGate } from "@/lib/wizard-state-machine";

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ wake?: string; notice?: string; tab?: string }>;
}) {
  const { id } = await params;
  const { wake, notice, tab } = await searchParams;
  const user = await getCurrentUser();
  const { locale, t } = await getI18n();
  const session = user ? await getSessionForUser(id, user.email) : undefined;

  if (!session) notFound();

  const currentPhase = t.phases[session.step - 1];
  const onGate = isGateStep(session.step);
  const gateBlocking =
    onGate && session.gateStatus[session.step] !== "approved";
  const isGate1 = session.step === 4;
  const isSpec = session.step === 3;
  const isGathering = session.step <= 3;
  const points = session.requirements?.points ?? [];
  const answers = session.requirements?.answers ?? [];
  const atEnd = session.step >= PHASE_COUNT;
  // The step before is a gate the session has passed: going back would reopen it.
  const backLocked = crossesPassedGate(session.step);
  // Gate 4 approved: nothing is left to do in the wizard but take the package.
  const solutionDone = atEnd && !gateBlocking;
  // On the PoC step the test run is the step's own action until one has
  // succeeded; "Next step" beside it in the same colour competed with it.
  const pocRunPending = session.step === POC_STEP && !session.lastSuccessfulRun;

  // The requirement questions come from the backend (session.requirements) and
  // reach the user as chat messages — the opening question is a real seeded
  // message. The greeting stays a stable welcome; it no longer embeds a question.
  const chatGreeting = t.chatGreeting;
  // After a gate approval in the panel the chat tells the agent (#173).
  const wakeMessage = /^[1-4]$/.test(wake ?? "")
    ? t.gateApprovedWake.replace("{n}", wake as string)
    : undefined;

  // A refused "Next step" or gate approval comes back as ?notice= (actions.ts).
  const noticeText =
    notice === "agent_busy"
      ? t.noticeAgentBusy
      : notice === "gate_not_ready"
        ? t.noticeGateNotReady
        : undefined;

  const gateSteps = Array.from({ length: PHASE_COUNT }, (_, i) => i + 1).filter(
    isGateStep,
  );

  return (
    <div className="flex h-dvh flex-col">
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

      <div className="flex min-h-0 flex-1">
        <GateTimeline
          locale={locale}
          step={session.step}
          phases={t.phases}
          gateSteps={gateSteps}
          gateStatus={session.gateStatus}
          phaseCount={PHASE_COUNT}
        />

        {/* overflow-clip, not overflow-hidden: a hidden box is still a scroll
            container, and content reaching past its edge let a scrollIntoView
            shift the whole workspace under the timeline (#35). */}
        <main
          id="main-content"
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-clip"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
            <div className="min-w-0">
              {/* The timeline is hidden below the desktop layout; the step stays readable here. */}
              <p className="text-xs text-text-muted lg:hidden">
                {t.phaseOf
                  .replace("{n}", String(session.step))
                  .replace("{total}", String(PHASE_COUNT))}
              </p>
              <h2
                data-testid="workspace-phase"
                className="truncate text-lg font-semibold tracking-tight text-text"
              >
                {currentPhase}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {!isGate1 && !isGathering && (
                <span className="hidden text-xs text-text-muted sm:inline">
                  {t.activeBlueprint} v{session.activeVersion} ·{" "}
                  {session.versions.length} {t.versions}
                </span>
              )}
              <OpenChatButton label={t.chat} className="btn-secondary px-3 py-1.5 xl:hidden" />
            </div>
          </div>

          <div className="scroll-thin relative flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
            {isGate1 ? (
              <Gate1Review
                sessionId={session.id}
                points={points}
                answers={answers}
                businessContext={session.businessContext}
                assumptions={session.assumptions}
                gateStatus={session.gateStatus[session.step]}
                t={t}
              />
            ) : isSpec ? (
              <FieldSchemaEditor fields={fieldSpecsFromTargetOutput(session.targetOutputSpec)} />
            ) : isGathering ? (
              <GatheringView
                points={points}
                answers={answers}
                t={t}
              />
            ) : (
              <>
                {gateBlocking && (
                  <div
                    role="status"
                    className="mb-4 flex shrink-0 items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2.5 text-sm text-warning-text"
                  >
                    <Icon name="flag" size={16} className="mt-0.5" />
                    <span>{t.gateNotice}</span>
                  </div>
                )}

                <WorkspacePanel
                  sessionId={session.id}
                  sessionTitle={session.title}
                  wizardStep={session.step}
                  blueprint={session.blueprint}
                  hasSuccessfulRun={Boolean(session.lastSuccessfulRun)}
                  latestRun={session.latestRun ?? null}
                  initialTab={tab === "poc" ? "poc" : undefined}
                  t={t}
                />
              </>
            )}
          </div>

          {noticeText && (
            <p
              role="status"
              className="mx-4 mt-3 shrink-0 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text sm:mx-6"
            >
              {noticeText}
            </p>
          )}
          {solutionDone && (
            <div
              role="status"
              className="mx-4 mt-3 flex shrink-0 flex-wrap items-center gap-3 rounded-md border border-success-border bg-success-bg px-3 py-2 text-sm text-success-text sm:mx-6"
              data-testid="solution-done"
            >
              <Icon name="circleCheck" size={16} />
              <span className="min-w-[16rem] flex-1">{t.solutionDone}</span>
              {session.lastSuccessfulRun ? (
                <a
                  href={`/api/sessions/${session.id}/poc/deployable`}
                  download
                  className="btn-secondary"
                >
                  <Icon name="download" size={16} />
                  {t.solutionDoneDownload}
                </a>
              ) : (
                <span>{t.solutionDoneNoRun}</span>
              )}
            </div>
          )}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-6">
            <form action={regress}>
              <input type="hidden" name="id" value={session.id} />
              {noticeText && <input type="hidden" name="notice" value="1" />}
              <PendingSubmitButton
                label={t.previous}
                pendingLabel={t.goingBack}
                disabled={session.step <= 1 || backLocked}
                title={backLocked ? t.previousLockedHint : undefined}
                icon="arrowLeft"
                className="btn-ghost"
              />
            </form>

            {!isGate1 &&
              (gateBlocking ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <GateObjection sessionId={session.id} t={t} />
                  <form action={approve}>
                    <input type="hidden" name="id" value={session.id} />
                    {noticeText && <input type="hidden" name="notice" value="1" />}
                    <PendingSubmitButton
                      label={t.approveGate}
                      pendingLabel={t.approving}
                      icon="check"
                      className="btn-brand"
                    />
                  </form>
                </div>
              ) : isGathering ? (
                <GatheringAdvanceButton
                  label={t.nextPhase}
                  hint={t.gatheringAdvanceHint}
                />
              ) : (
                <form action={advance} className="flex items-center gap-3">
                  <input type="hidden" name="id" value={session.id} />
                  {noticeText && <input type="hidden" name="notice" value="1" />}
                  {!atEnd && (
                    <span
                      className="hidden max-w-xs text-right text-xs text-text-muted xl:block"
                      data-testid="next-phase-hint"
                    >
                      {t.nextPhaseHint}
                    </span>
                  )}
                  <PendingSubmitButton
                    label={atEnd ? t.ready : t.nextPhase}
                    pendingLabel={t.advancing}
                    disabled={atEnd}
                    title={atEnd ? undefined : t.nextPhaseHint}
                    icon={atEnd ? "check" : "arrowRight"}
                    iconAfter={!atEnd}
                    className={pocRunPending ? "btn-secondary" : "btn-brand"}
                  />
                </form>
              ))}
          </div>
        </main>

        <ChatDock
          key={session.id}
          sessionId={session.id}
          initialMessages={session.messages}
          autoSend={wakeMessage}
          busyLabel={t.chatBusy}
          errorLabels={t.chatErrors}
          activityLabels={t.chatActivity}
          chatTitle={t.chat}
          greeting={chatGreeting}
          aiNotice={t.chatAiNotice}
          assistantLabel={t.chatAssistantLabel}
          inputPlaceholder={t.chatInputPlaceholder}
          inputLabel={t.chatInputLabel}
          sendLabel={t.chatSend}
          streamFailedLabel={t.streamFailed}
          thinkingLabel={t.chatThinking}
          wide={isGathering}
          hideChatLabel={t.hideChat}
          showChatLabel={t.showChat}
          resizeLabel={t.chatResize}
          defaultOpen={!shouldCollapseChatByDefault(session.step)}
        />
      </div>
    </div>
  );
}
