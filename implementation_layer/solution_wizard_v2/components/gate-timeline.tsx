"use client";

import { useEffect, useState, useTransition } from "react";
import { reopen } from "@/app/sessions/[id]/actions";
import type { GateStatus } from "@/lib/sessions";
import { askInChat } from "@/lib/chat-events";
import { fillTemplate } from "@/lib/chat-template";
import { gateReference } from "@/lib/gate-guide";
import {
  nextGateStep,
  stageState as stageStateFor,
  type StageState,
} from "@/lib/gate-timeline-state";
import { Icon } from "./icons";

/** The timeline's copy that the rest of the shell shares (lib/i18n). */
export type TimelineGuide = {
  /** "Nyt" */
  nowTitle: string;
  /** What to do now, the same line as under the phase title. */
  nowText: string;
  /** Each gate's business topic, Gate 1–4. */
  topics: string[];
  /** Each gate's decision, named on its row ("Hyväksy ratkaisun rakenne"). */
  decisions: string[];
  /** What the user checks when approving each gate. */
  checks: string[][];
  checksTitle: string;
  /** "Gate {n}" */
  tag: string;
  /** "Muuta", under an approved stage, and its accessible name ({topic}). */
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
    approved: "Approved",
    now: "Now",
    rejected: "Rejected",
    stepsDone: (done: number, all: number) => `${done}/${all} steps`,
    gatesDone: (done: number, all: number) => `${done} of ${all} gates approved`,
    allDone: "Done",
  },
  fi: {
    title: "Vaiheet",
    phaseOf: (a: number, b: number) => `Vaihe ${a} / ${b}`,
    approved: "Hyväksytty",
    now: "Nyt",
    rejected: "Hylätty",
    stepsDone: (done: number, all: number) => `${done}/${all} vaihetta`,
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
 * The phases grouped by the gate that closes them, each stage led by its
 * business topic, and under them a card that says what to do now and what the
 * next gate's approval checks. Compact on purpose: the column sits beside the
 * workspace and the chat.
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
  // The gate the session works towards; none once the last one is approved.
  const upcoming = nextGateStep(step, gateSteps, gateStatus);
  const nextGate = upcoming ? gateSteps.indexOf(upcoming) + 1 : 0;
  const gateTag = (n: number) => (
    <span className="shrink-0 rounded border border-border px-1 py-px text-[10px] font-medium leading-none text-text-muted">
      {fillTemplate(guide.tag, { n: String(n) })}
    </span>
  );

  const list = (
    <ol className="space-y-0.5">
      {stages.map((st, idx) => {
        const state = stageState(st);
        const isCollapsed = collapsed[idx] ?? autoCollapsed(st);
        const gs = st.gateStep ? gateStatus[st.gateStep] : undefined;
        const gate = st.gateStep ? gateSteps.indexOf(st.gateStep) + 1 : 0;
        const topic = gate ? guide.topics[gate - 1] : "";
        const done = st.steps.filter((s) => s.step < step).length;
        const atGate = st.gateStep === step;
        return (
          <li key={idx}>
            <button
              type="button"
              onClick={() => toggle(idx, st)}
              aria-expanded={!isCollapsed}
              className={`flex w-full items-center gap-2.5 rounded-md px-2 pt-1.5 text-left transition-colors hover:bg-surface-muted ${
                state === "approved" ? "pb-0.5" : "pb-1.5"
              }`}
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
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-[13px] ${
                    state === "current" ? "font-semibold text-text" : "font-medium text-text-secondary"
                  }`}
                >
                  {topic}
                </span>
                {/* The approved stage's line sits under the button: it holds
                    its own "Change" button. */}
                {state !== "approved" && gate > 0 && (
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-muted">
                    {gateTag(gate)}
                    {state === "current" && (
                      <span className="truncate">
                        {L.stepsDone(Math.min(done, st.steps.length), st.steps.length)}
                      </span>
                    )}
                  </span>
                )}
              </span>
              {state === "pending" && <Icon name="lock" size={13} className="text-text-muted" />}
              <Icon
                name="chevronDown"
                size={14}
                className={`text-text-muted transition-transform duration-150 motion-reduce:transition-none ${isCollapsed ? "-rotate-90" : ""}`}
              />
            </button>

            {/* An approved stage says so, with a way to ask for a change in
                the chat: the agent owns the artifacts, so a change goes to it. */}
            {state === "approved" && gate > 0 && st.gateStep && (
              <div className="mb-1.5 flex items-center gap-1.5 pl-[42px] text-[11px] text-text-muted">
                {gateTag(gate)}
                <span>{L.approved}</span>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  onClick={() => {
                    setReopenError(null);
                    setAsking((open) => (open === gate ? null : gate));
                  }}
                  aria-expanded={asking === gate}
                  aria-label={fillTemplate(guide.changeLabel, { topic })}
                  data-testid={`gate-change-${gate}`}
                  className="rounded px-0.5 font-medium text-brand-text underline-offset-2 hover:underline"
                >
                  {guide.change}
                </button>
              </div>
            )}
            {state === "approved" && gate > 0 && st.gateStep && asking === gate && (
              <div
                role="group"
                aria-label={fillTemplate(guide.changeLabel, { topic })}
                data-testid={`gate-reopen-${gate}`}
                className="mb-2 ml-[42px] mr-2 rounded-md border border-border bg-app px-2.5 py-2 text-[12px] leading-snug text-text-secondary"
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

            {!isCollapsed && (
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
                  <li
                    aria-current={atGate ? "step" : undefined}
                    className={`mt-0.5 flex items-center gap-2 rounded-md py-1 text-[12.5px] ${
                      atGate && state === "current" ? "-ml-1.5 bg-brand-soft px-1.5" : ""
                    }`}
                  >
                    <Icon
                      name={state === "approved" ? "circleCheck" : state === "current" ? "flag" : "lock"}
                      size={13}
                      className={
                        state === "approved" || (atGate && state === "current")
                          ? "text-brand-strong"
                          : "text-text-muted"
                      }
                    />
                    <span
                      className={`min-w-0 flex-1 ${
                        atGate && state === "current" ? "font-semibold text-brand-text" : "text-text-secondary"
                      }`}
                    >
                      {guide.decisions[gate - 1]}
                    </span>
                    {state === "current" && atGate && (
                      <span className="shrink-0 text-[11px] font-medium text-brand-text">
                        {gs === "rejected" ? L.rejected : L.now}
                      </span>
                    )}
                  </li>
                )}
              </ol>
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

        {/* The space under the list says what to do now and what the next
            gate's approval checks, so "Gate 2" means something before it. */}
        <section
          aria-labelledby="timeline-now"
          data-testid="timeline-now"
          className="mx-1 mt-4 rounded-lg border border-border bg-app px-3 py-3"
        >
          <h3 id="timeline-now" className="text-[11px] font-semibold text-brand-text">
            {guide.nowTitle}
          </h3>
          <p className="mt-1 text-[13px] font-semibold leading-snug text-text">{phases[step - 1]}</p>
          <p className="mt-1 text-[12.5px] leading-snug text-text-secondary">{guide.nowText}</p>
          {nextGate > 0 && (
            <div className="mt-3 border-t border-border pt-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
                {gateTag(nextGate)}
                {guide.checksTitle}
              </p>
              <ul className="mt-1.5 space-y-1 text-[12px] leading-snug text-text-secondary">
                {guide.checks[nextGate - 1]?.map((item) => (
                  <li key={item} className="flex gap-1.5">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-border-strong" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
