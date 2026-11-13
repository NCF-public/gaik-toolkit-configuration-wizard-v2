"use client";

import { useEffect, useState, useTransition } from "react";
import { reopen } from "@/app/sessions/[id]/actions";
import type { GateStatus } from "@/lib/sessions";
import { askInChat } from "@/lib/chat-events";
import { fillTemplate } from "@/lib/chat-template";
import { gateReference } from "@/lib/gate-guide";
import { stageState as stageStateFor, type StageState } from "@/lib/gate-timeline-state";
import { Icon } from "./icons";

/** The timeline's copy that the rest of the shell shares (lib/i18n). */
export type TimelineGuide = {
  /** Each gate's business topic, Gate 1–4. */
  topics: string[];
  /** Each gate's decision, named on its row ("Hyväksy ratkaisun rakenne"). */
  decisions: string[];
  /** What the user checks when approving each gate. */
  checks: string[][];
  checksTitle: string;
  /** "Muuta", in an approved stage once it is opened, and its accessible name ({topic}). */
  change: string;
  changeLabel: string;
  /** The chat reference a change starts: chip ({n}, {topic}) and message prefix. */
  chip: string;
  changePrefix: string;
  /** Reopening an approved gate for a change: the question ({n}) and its buttons. */
  reopen: {
    question: string;
    confirm: string;
    cancel: string;
    working: string;
    busy: string;
    failed: string;
  };
};

type Props = {
  sessionId: string;
  locale: "fi" | "en";
  step: number;
  phases: string[];
  gateSteps: number[];
  gateStatus: Record<number, GateStatus>;
  phaseCount: number;
  guide: TimelineGuide;
  /** "aside": the column beside the workspace (lg and up); "inline": a card
   *  under the step's title on a narrower screen. */
  variant?: "aside" | "inline";
};

type Stage = {
  steps: { step: number; name: string }[];
  gateStep: number | null;
};

const LABELS = {
  en: {
    title: "Steps",
    phaseOf: (a: number, b: number) => `Step ${a} / ${b}`,
    rejected: "Rejected",
    gatesDone: (done: number, all: number) => `${done} of ${all} gates approved`,
    allDone: "Done",
  },
  fi: {
    title: "Vaiheet",
    phaseOf: (a: number, b: number) => `Vaihe ${a} / ${b}`,
    rejected: "Hylätty",
    gatesDone: (done: number, all: number) => `${done}/${all} gatea hyväksytty`,
    allDone: "Valmis",
  },
} as const;

/** The approved gates as a ring: "2/4" inside it, a check when all are. */
function GateRing({ done, total, label }: { done: number; total: number; label: string }) {
  const radius = 15;
  const length = 2 * Math.PI * radius;
  const share = total > 0 ? Math.min(done / total, 1) : 0;
  const full = total > 0 && done >= total;
  return (
    <span
      role="img"
      aria-label={label}
      data-testid="gate-ring"
      className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center"
    >
      <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={radius} fill="none" strokeWidth="3" className="stroke-surface-muted" />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - share)}
          className="stroke-brand transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-text">
        {full ? <Icon name="check" size={16} className="text-brand-strong" /> : `${done}/${total}`}
      </span>
    </span>
  );
}

/**
 * The phases grouped by the gate that closes them, each stage one row: a mark
 * (approved, in progress, ahead) and its business topic. That answers "where
 * am I, what comes next" at a glance. The rest is behind a press on the row:
 * the stage's steps, what its approval checks (a press on the gate's row), and
 * "Change" for a stage that is approved. A press, not a hover: rows that open
 * under the pointer move the list while it is being read, and a touch screen
 * has only the press.
 */
export function GateTimeline({
  sessionId,
  locale,
  step,
  phases,
  gateSteps,
  gateStatus,
  phaseCount,
  guide,
  variant = "aside",
}: Props) {
  const L = LABELS[locale];
  const inline = variant === "inline";

  // Group the phases: each stage ends at its gate.
  const stages: Stage[] = [];
  let cur: { step: number; name: string }[] = [];
  phases.forEach((name, i) => {
    const s = i + 1;
    if (gateSteps.includes(s)) {
      stages.push({ steps: cur, gateStep: s });
      cur = [];
    } else {
      cur.push({ step: s, name });
    }
  });
  if (cur.length) stages.push({ steps: cur, gateStep: null });

  const stageBounds = (st: Stage) => {
    const first = st.steps[0]?.step ?? st.gateStep ?? 0;
    const last = st.gateStep ?? st.steps[st.steps.length - 1]?.step ?? first;
    return { first, last };
  };
  const stageState = (st: Stage): StageState =>
    stageStateFor(step, stageBounds(st), st.gateStep, gateStatus);

  // No override = auto: the current stage is open, the others closed. A click
  // on a stage overrides that for the stage.
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const autoCollapsed = (st: Stage) => stageState(st) !== "current";
  const toggle = (idx: number, st: Stage) =>
    setCollapsed((c) => ({ ...c, [idx]: !(c[idx] ?? autoCollapsed(st)) }));

  // What a gate's approval checks, shown under its row on request.
  const [checksOpen, setChecksOpen] = useState<Record<number, boolean>>({});

  // "Change" on an approved gate asks first: reopening takes back that
  // approval and the later ones. Once reopened, the chat opens with the gate
  // as the reference, where the user says what to change.
  const [asking, setAsking] = useState<number | null>(null);
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [reopening, startReopen] = useTransition();
  // The gate was reopened meanwhile (by the wizard, or in another tab): the
  // question is answered, and must not come back open when it is approved again.
  const askedStep = asking === null ? undefined : gateSteps[asking - 1];
  const askedStillApproved = askedStep === undefined || gateStatus[askedStep] === "approved";
  useEffect(() => {
    if (!askedStillApproved) setAsking(null);
  }, [askedStillApproved]);
  const reopenGate = (gate: number, gateStep: number) =>
    startReopen(async () => {
      setReopenError(null);
      const outcome = await reopen(sessionId, gate).catch(() => "failed" as const);
      if (outcome === "busy") {
        setReopenError(guide.reopen.busy);
        return;
      }
      if (outcome === "failed") {
        setReopenError(guide.reopen.failed);
        return;
      }
      // "not_approved": another tab reopened it first; the page now shows it.
      setAsking(null);
      askInChat(
        gateReference(
          { topics: guide.topics, chip: guide.chip, prefix: guide.changePrefix },
          gate,
          gateStep,
        ),
      );
    });

  // How far the session is, in the unit the user decides in: approved gates.
  const approvedGates = gateSteps.filter((s) => gateStatus[s] === "approved").length;
  const allApproved = gateSteps.length > 0 && approvedGates === gateSteps.length;
  const list = (
    <ol className="space-y-0.5">
      {stages.map((st, idx) => {
        const state = stageState(st);
        const isCollapsed = collapsed[idx] ?? autoCollapsed(st);
        const gs = st.gateStep ? gateStatus[st.gateStep] : undefined;
        const gate = st.gateStep ? gateSteps.indexOf(st.gateStep) + 1 : 0;
        const topic = gate ? guide.topics[gate - 1] : "";
        const atGate = st.gateStep === step;
        const checks = gate ? (guide.checks[gate - 1] ?? []) : [];
        const showChecks = Boolean(checksOpen[gate]) && state !== "approved" && checks.length > 0;
        const gateRow = (
          <>
            <Icon
              name={state === "approved" ? "circleCheck" : state === "current" ? "flag" : "lock"}
              size={13}
              className={
                state === "approved" || (atGate && state === "current") ? "text-brand-strong" : "text-text-muted"
              }
            />
            <span
              className={`min-w-0 flex-1 ${
                atGate && state === "current" ? "font-semibold text-brand-text" : "text-text-secondary"
              }`}
            >
              {gate ? guide.decisions[gate - 1] : ""}
            </span>
            {/* A rejected gate says so; the one being decided is marked by its
                colour alone. */}
            {state === "current" && atGate && gs === "rejected" && (
              <span className="shrink-0 text-[11px] font-medium text-danger-text">{L.rejected}</span>
            )}
          </>
        );
        return (
          <li key={idx}>
            <button
              type="button"
              onClick={() => toggle(idx, st)}
              aria-expanded={!isCollapsed}
              data-testid={gate ? `timeline-stage-${gate}` : undefined}
              data-state={state}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-muted"
            >
              <span
                className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  state === "approved"
                    ? "bg-brand text-on-brand"
                    : state === "current"
                      ? "border-2 border-brand text-brand-text"
                      : "border border-border-strong text-text-muted"
                }`}
                aria-hidden
              >
                {state === "approved" ? <Icon name="check" size={13} /> : gate}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-[13px] ${
                  state === "current"
                    ? "font-semibold text-text"
                    : state === "approved"
                      ? "font-medium text-text-secondary"
                      : "font-medium text-text-muted"
                }`}
              >
                {topic}
              </span>
              <Icon
                name="chevronDown"
                size={14}
                className={`text-text-muted transition-transform duration-150 motion-reduce:transition-none ${isCollapsed ? "-rotate-90" : ""}`}
              />
            </button>

            {!isCollapsed && (
              <div className="reveal-in">
                <ol className="mb-1.5 ml-[18px] border-l border-border pl-3">
                  {st.steps.map((s) => {
                    const isDone = s.step < step;
                    const isCur = s.step === step;
                    return (
                      <li
                        key={s.step}
                        aria-current={isCur ? "step" : undefined}
                        className="flex items-center gap-2 py-1 text-[12.5px]"
                      >
                        {isDone ? (
                          <Icon name="check" size={13} className="text-brand-strong" />
                        ) : (
                          <span
                            className={`mx-[3.5px] h-1.5 w-1.5 shrink-0 rounded-full ${
                              isCur ? "bg-brand ring-4 ring-brand-soft" : "bg-border-strong"
                            }`}
                            aria-hidden
                          />
                        )}
                        <span
                          className={
                            isCur
                              ? "font-semibold text-brand-text"
                              : isDone
                                ? "text-text-secondary"
                                : "text-text-muted"
                          }
                        >
                          {s.name}
                        </span>
                      </li>
                    );
                  })}
                  {st.gateStep && (
                    <li aria-current={atGate ? "step" : undefined} className="mt-0.5 text-[12.5px]">
                      <div
                        className={`flex items-center gap-2 rounded-md py-0.5 ${
                          atGate && state === "current" ? "-ml-1.5 bg-brand-soft pl-1.5" : ""
                        }`}
                      >
                        {gateRow}
                        {/* What the approval checks, behind its own control: the
                            row itself is named like the approve button, so it
                            is not one. */}
                        {state !== "approved" && checks.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setChecksOpen((open) => ({ ...open, [gate]: !open[gate] }))}
                            aria-expanded={showChecks}
                            aria-label={`${guide.checksTitle} ${topic}`}
                            title={`${guide.checksTitle} ${topic}`}
                            data-testid={`gate-checks-toggle-${gate}`}
                            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-surface-muted hover:text-text ${
                              showChecks ? "text-brand-text" : "text-text-muted"
                            }`}
                          >
                            <Icon name="listChecks" size={14} />
                          </button>
                        )}
                      </div>
                      {showChecks && (
                        <div className="reveal-in pb-1 pl-[21px] pt-1" data-testid={`gate-checks-${gate}`}>
                          <p className="text-[11px] font-medium text-text-muted">{guide.checksTitle}</p>
                          <ul className="mt-1 space-y-0.5 text-[12px] leading-snug text-text-secondary">
                            {checks.map((item) => (
                              <li key={item} className="flex gap-1.5">
                                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-border-strong" aria-hidden />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  )}
                </ol>

                {/* An approved stage can be asked to change in the chat: the
                    agent owns the artifacts, so a change goes to it. */}
                {state === "approved" && gate > 0 && st.gateStep && asking !== gate && (
                  <button
                    type="button"
                    onClick={() => {
                      setReopenError(null);
                      setAsking(gate);
                    }}
                    aria-label={fillTemplate(guide.changeLabel, { topic })}
                    data-testid={`gate-change-${gate}`}
                    className="mb-2 ml-[30px] inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-[12px] font-medium text-brand-text underline-offset-2 hover:underline"
                  >
                    <Icon name="pencil" size={12} />
                    {guide.change}
                  </button>
                )}
                {state === "approved" && gate > 0 && st.gateStep && asking === gate && (
                  <div
                    role="group"
                    aria-label={fillTemplate(guide.changeLabel, { topic })}
                    data-testid={`gate-reopen-${gate}`}
                    className="reveal-in mb-2 ml-[30px] mr-2 rounded-md border border-border bg-app px-2.5 py-2 text-[12px] leading-snug text-text-secondary"
                  >
                    <p>{fillTemplate(guide.reopen.question, { n: String(gate) })}</p>
                    {reopenError && (
                      <p role="alert" className="mt-1 text-warning-text">
                        {reopenError}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        disabled={reopening}
                        onClick={() => reopenGate(gate, st.gateStep as number)}
                        data-testid={`gate-reopen-confirm-${gate}`}
                        className="btn-secondary px-2 py-1 text-[12px]"
                      >
                        {reopening ? guide.reopen.working : guide.reopen.confirm}
                      </button>
                      <button
                        type="button"
                        disabled={reopening}
                        onClick={() => setAsking(null)}
                        className="btn-ghost px-2 py-1 text-[12px]"
                      >
                        {guide.reopen.cancel}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );

  // On a narrow screen the line under the phase title already says what to do
  // now, so the inline card is the list alone.
  if (inline) {
    return (
      // No taller than most of the screen: with every stage open the card
      // pushed the step's view out of a phone's window; the list scrolls inside.
      <nav
        aria-label={L.title}
        className="scroll-thin max-h-[60dvh] overflow-y-auto rounded-lg border border-border bg-surface px-1 py-1.5"
      >
        {list}
      </nav>
    );
  }

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <div className="shrink-0 border-b border-border px-4 pb-3 pt-3.5">
        {/* One glance says how far the session is: a ring of the approved
            gates, full with a check once the solution is done. */}
        <div className="flex items-center gap-3">
          <GateRing
            done={approvedGates}
            total={gateSteps.length}
            label={L.gatesDone(approvedGates, gateSteps.length)}
          />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text">{L.title}</h2>
            <p className="text-xs text-text-muted" data-testid="timeline-progress">
              {allApproved ? L.allDone : L.phaseOf(step, phaseCount)}
            </p>
          </div>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <nav aria-label={L.title}>{list}</nav>
      </div>
    </aside>
  );
}
