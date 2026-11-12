import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getI18n } from "@/lib/i18n";
import { AppHeader } from "@/components/app-header";
import { ChatDock, OpenChatButton } from "@/components/chat-dock";
import { Icon } from "@/components/icons";
import { WorkspacePanel } from "@/components/workspace-panel";
import { GateTimeline, type TimelineGuide } from "@/components/gate-timeline";
import { StepsDisclosure } from "@/components/steps-disclosure";
import { Gate1Review, gate1Missing } from "@/components/gate1-review";
import { GateDecisionBar, type GateDecisionLabels } from "@/components/gate-decision-bar";
import { GatheringView } from "@/components/gathering-view";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { FieldSchemaEditor } from "@/components/field-schema-editor";
import { fieldSpecsFromTargetOutput } from "@/lib/target-output-spec";
import { advance, endWizard, regress } from "./actions";
import { getSessionForUser } from "@/lib/session-access";
import { PHASE_COUNT, isGateStep } from "@/lib/sessions";
import { shouldCollapseChatByDefault } from "@/lib/bpmn-spike";
import { GATE_STEPS, canStepBack, gateNumber } from "@/lib/wizard-state-machine";
import { nowLine } from "@/lib/gate-guide";
import { GATE_MOVED_NOTICE } from "@/lib/step-redirect";
import { parseTabParam } from "@/lib/workspace-tab-follow";
import { chatLeads } from "@/lib/session-start";

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
  // Gate 1–4 on a gate step, 0 elsewhere.
  const gate = gateNumber(session.step) ?? 0;
  const gateBlocking = gate > 0 && session.gateStatus[session.step] !== "approved";
  const isGate1 = gate === 1;
  const isSpec = session.step === 3;
  const isGathering = session.step <= 3;
  const points = session.requirements?.points ?? [];
  const answers = session.requirements?.answers ?? [];
  // While requirements are gathered the session happens in the chat. With no
  // checklist to show beside it, the chat is the page's main content, and the
  // workspace comes in with the specification.
  const chatIsPage = chatLeads(session.step, points);
  const atEnd = session.step >= PHASE_COUNT;
  // Gate 4 approved: nothing is left to do in the wizard but take the package.
  const solutionDone = atEnd && !gateBlocking;
  // "Previous" only where the step before shows something else (gathering up
  // to Gate 1); later steps share one workspace and have no step back.
  const showPrevious = canStepBack(session.step);
  // Between gates the agent moves the step as it writes its artifacts; "Next
  // step" stays as a quiet fallback for when that does not happen. It is also
  // the way on from a gate that is already approved (the step came back onto
  // it, or the move after the approval was refused). Gathering is the agent's
  // alone, and a pending gate moves on by its approval.
  const showNext = !isGathering && !gateBlocking && !atEnd;
  const now = nowLine(t, session.step, session.gateStatus, Boolean(session.lastSuccessfulRun));

  // The requirement questions come from the backend (session.requirements) and
  // reach the user as chat messages — the opening question is a real seeded
  // message. The greeting stays a stable welcome; it no longer embeds a question.
  const chatGreeting = t.chatGreeting;
  // After a gate approval in the panel the chat tells the agent (#173).
  // Only for a gate that is approved: the address alone (a link in a reply,
  // say) must not tell the agent a pending gate was approved.
  const wokenGate = /^[1-4]$/.test(wake ?? "") ? Number(wake) : undefined;
  const wakeMessage =
    wokenGate !== undefined && session.gateStatus[GATE_STEPS[wokenGate - 1]] === "approved"
      ? t.gateApprovedWake.replace("{n}", String(wokenGate))
      : undefined;

  // A refused "Next step" or gate approval comes back as ?notice= (actions.ts).
  const noticeText =
    notice === "agent_busy"
      ? t.noticeAgentBusy
      : notice === "gate_not_ready"
        ? t.noticeGateNotReady
        : notice === GATE_MOVED_NOTICE
          ? t.noticeGateMoved
          : notice === "end_failed"
            ? t.noticeEndFailed
            : undefined;

  const gateSteps = Array.from({ length: PHASE_COUNT }, (_, i) => i + 1).filter(
    isGateStep,
  );

  const timelineGuide: TimelineGuide = {
    nowTitle: t.nowTitle,
    nowText: now,
    topics: t.gateTopics,
    decisions: t.gateDecisions,
    checks: t.gateChecks,
    checksTitle: t.gateChecksTitle,
    tag: t.gateTag,
    change: t.gateChange,
    changeLabel: t.gateChangeLabel,
    chip: t.gateChip,
    changePrefix: t.gateChangePrefix,
    reopen: t.gateReopen,
  };
  // A gate reopened for a change: said above the workspace until it is approved again.
  const reopened = session.gateReopened ?? null;
  const reopenedText = reopened
    ? {
        user: t.gateReopenedByUser,
        agent: t.gateReopenedByWizard,
        change: t.gateReopenedByChange,
      }[reopened.by]
        .replace("{n}", String(reopened.gate))
        .replace("{topic}", t.gateTopics[reopened.gate - 1] ?? "")
    : undefined;
  const timeline = {
    sessionId: session.id,
    locale,
    step: session.step,
    phases: t.phases,
    gateSteps,
    gateStatus: session.gateStatus,
    phaseCount: PHASE_COUNT,
    guide: timelineGuide,
  };

  const decisionLabels: GateDecisionLabels | null = gate
    ? {
        approve: t.gateApprove[gate - 1],
        approveShort: t.gateApproveShort,
        approving: t.approving,
        note: t.gateApproveNotes[gate - 1],
        requestChanges: t.gateRequestChanges,
        topics: t.gateTopics,
        chip: t.gateChip,
        requestPrefix: t.gateRequestPrefix,
        reject: t.gateReject,
        rejectReason: t.gateRejectReason,
        rejectPlaceholder: t.gateRejectPlaceholder,
        rejectHow: t.gateRejectHow,
        rejectSubmit: t.gateRejectSubmit,
        rejectCancel: t.gateRejectCancel,
        rejectMessage: t.gateRejectMessage,
        rejected: t.gateRejected,
        rejectFailed: t.gateRejectFailed,
        rejectResend: t.gateRejectResend,
        rejectNotSaved: t.gateRejectNotSaved,
      }
    : null;
  // Gate 1 is approvable once the wizard has the core business framing.
  const missing = isGate1 ? gate1Missing(session.businessContext, t) : [];

  // In the gate decision bar on a phone (a narrow container) "Previous" is
  // its arrow alone, so the bar stays one row; elsewhere it shows its label.
  const previousForm = showPrevious && (
    <form action={regress}>
      <input type="hidden" name="id" value={session.id} />
      {noticeText && <input type="hidden" name="notice" value="1" />}
      <PendingSubmitButton
        label={<span className="@max-xl:sr-only">{t.previous}</span>}
        pendingLabel={<span className="@max-xl:sr-only">{t.goingBack}</span>}
        icon="arrowLeft"
        className="btn-ghost @max-xl:px-2.5"
      />
    </form>
  );

  // A reopened gate and a refused action, said above the decision bar, or
  // above the chat while it is the page.
  const notices = (
    <>
      {reopenedText && (
        <p
          role="status"
          data-testid="gate-reopened"
          className="mx-4 mt-3 flex shrink-0 items-start gap-2 rounded-md border border-brand-soft-border bg-brand-soft px-3 py-2 text-sm text-brand-text sm:mx-6"
        >
          <Icon name="flag" size={16} className="mt-0.5 shrink-0" />
          <span>{reopenedText}</span>
        </p>
      )}
      {noticeText && (
        <p
          role="status"
          className="mx-4 mt-3 shrink-0 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text sm:mx-6"
        >
          {noticeText}
        </p>
      )}
    </>
  );
  const stepsDisclosure = (
    <StepsDisclosure
      summary={t.phaseOf
        .replace("{n}", String(session.step))
        .replace("{total}", String(PHASE_COUNT))}
      // Above the chat that is the page, the step line has no chat button beside it.
      besideButton={!chatIsPage}
    >
      <GateTimeline variant="inline" {...timeline} />
    </StepsDisclosure>
  );

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader locale={locale} t={t} email={user?.email}>
        {/* The logo beside this leads to the sessions; a "Sessiot" crumb said it twice. */}
        <h1 className="truncate text-sm font-semibold text-text">{session.title}</h1>
      </AppHeader>

      <div className="flex min-h-0 flex-1">
        <GateTimeline {...timeline} />

        {/* overflow-clip, not overflow-hidden: a hidden box is still a scroll
            container, and content reaching past its edge let a scrollIntoView
            shift the whole workspace under the timeline (#35). */}
        {!chatIsPage && (
        <main
          id="main-content"
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-clip"
        >
          <div className="relative shrink-0 border-b border-border px-4 py-3 sm:px-6">
            {/* The chat button sits in the corner, beside the step line and
                the title only, so the line under them has the full width. */}
            <OpenChatButton
              label={t.chat}
              className="btn-secondary absolute right-4 top-3 px-3 py-1.5 sm:right-6 xl:hidden"
            />
            {/* The timeline column is hidden below the desktop layout; the
                step line here opens it under the title. */}
            {stepsDisclosure}
            <h2
              data-testid="workspace-phase"
              className="truncate pr-36 text-lg font-semibold tracking-tight text-text xl:pr-0"
            >
              {currentPhase}
            </h2>
            {/* What to do now, and where: one line instead of a banner. On a
                desktop without the chat column it starts beside the chat
                button, so it keeps clear of it. */}
            <p
              data-testid="now-line"
              className="mt-0.5 text-sm text-text-secondary lg:max-xl:pr-36"
            >
              <span className="mr-1.5 font-semibold text-brand-text">{t.nowTitle}</span>
              {now}
            </p>
          </div>

          {/* The finished solution is said where the eye lands first, with
              what there is to do with it; it used to be a bar under the
              workspace that the line above pointed "below" to. */}
          {solutionDone && (
            <section
              role="status"
              aria-labelledby="solution-done-title"
              data-testid="solution-done"
              className="mx-4 mt-4 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-success-border bg-success-bg px-4 py-3 sm:mx-6"
            >
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-success-text"
              >
                <Icon name="circleCheck" size={20} />
              </span>
              <div className="min-w-[16rem] flex-1">
                <h3 id="solution-done-title" className="text-sm font-semibold text-text">
                  {t.solutionDoneTitle}
                </h3>
                {/* Without a run there is no package to take yet: the reason
                    reads on in the same text. */}
                <p className="mt-0.5 text-sm text-text-secondary">
                  {t.solutionDone}
                  {!session.lastSuccessfulRun && <> {t.solutionDoneNoRun}</>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {session.lastSuccessfulRun && (
                  <>
                    <a
                      href={`/api/sessions/${session.id}/poc/deployable`}
                      download
                      className="btn-brand"
                    >
                      <Icon name="download" size={16} />
                      {t.solutionDoneDownload}
                    </a>
                    <a href={`/sessions/${session.id}/cases`} className="btn-secondary">
                      <Icon name="users" size={16} />
                      {t.solutionDoneTry}
                    </a>
                  </>
                )}
                <form action={endWizard}>
                  <input type="hidden" name="id" value={session.id} />
                  <PendingSubmitButton
                    label={t.endSession}
                    pendingLabel={t.endingSession}
                    icon="logOut"
                    title={t.endSessionHint}
                    className="btn-ghost"
                  />
                </form>
              </div>
            </section>
          )}

          <div className="scroll-thin relative flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
            {isGate1 ? (
              <Gate1Review
                points={points}
                answers={answers}
                businessContext={session.businessContext}
                assumptions={session.assumptions}
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
              <WorkspacePanel
                sessionId={session.id}
                sessionTitle={session.title}
                wizardStep={session.step}
                gate2Approved={session.gateStatus[GATE_STEPS[1]] === "approved"}
                blueprint={session.blueprint}
                hasSuccessfulRun={Boolean(session.lastSuccessfulRun)}
                latestRun={session.latestRun ?? null}
                wizardReplying={Boolean(session.pendingTurn)}
                reopenedAt={reopened ? (reopened.at ?? `gate-${reopened.gate}`) : null}
                initialTab={parseTabParam(tab)}
                t={t}
              />
            )}
          </div>

          {notices}
          {gateBlocking && decisionLabels ? (
            <GateDecisionBar
              // A new gate gets a new bar: a reason typed for one gate is not
              // left in the form of the next.
              key={session.step}
              sessionId={session.id}
              gate={gate}
              gateStep={session.step}
              rejected={session.gateStatus[session.step] === "rejected"}
              blocked={missing.length > 0}
              warning={
                missing.length > 0 && (
                  <>
                    {t.gate1MissingContext}{" "}
                    <span className="font-semibold">
                      {t.gate1Missing}: {missing.join(", ")}
                    </span>
                  </>
                )
              }
              hadNotice={Boolean(noticeText)}
              leading={previousForm}
              labels={decisionLabels}
            />
          ) : (
            (previousForm || showNext) && (
              <div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-3 sm:px-6">
                {previousForm}
                {showNext && (
                  <form action={advance} className="ml-auto">
                    <input type="hidden" name="id" value={session.id} />
                    {noticeText && <input type="hidden" name="notice" value="1" />}
                    <PendingSubmitButton
                      label={t.nextPhase}
                      pendingLabel={t.advancing}
                      icon="arrowRight"
                      iconAfter
                      className="btn-secondary"
                    />
                  </form>
                )}
              </div>
            )
          )}
        </main>
        )}

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
          lead={chatIsPage}
          leadHeader={
            chatIsPage && (
              <>
                {/* The steps column is hidden below the desktop layout; the
                    step line here opens it, as it does above the workspace. */}
                <div className="shrink-0 px-4 pt-3 sm:px-6 lg:hidden">{stepsDisclosure}</div>
                {notices}
              </>
            )
          }
          hideChatLabel={t.hideChat}
          showChatLabel={t.showChat}
          resizeLabel={t.chatResize}
          questionLabels={t.chatQuestions}
          pendingTurn={session.pendingTurn ?? null}
          defaultOpen={!shouldCollapseChatByDefault(session.step, gateBlocking)}
        />
      </div>
    </div>
  );
}
