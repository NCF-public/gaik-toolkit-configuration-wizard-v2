"use client";

import { useState } from "react";
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
};

type Props = {
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
  },
  fi: {
    title: "Vaiheet",
    phaseOf: (a: number, b: number) => `Vaihe ${a} / ${b}`,
    approved: "Hyväksytty",
    now: "Nyt",
    rejected: "Hylätty",
    stepsDone: (done: number, all: number) => `${done}/${all} vaihetta`,
  },
} as const;

/**
 * The phases grouped by the gate that closes them, each stage led by its
 * business topic, and under them a card that says what to do now and what the
 * next gate's approval checks. Compact on purpose: the column sits beside the
 * workspace and the chat.
 */
export function GateTimeline({
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

  const progress = Math.round(((step - 1) / (phaseCount - 1)) * 100);
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
              <div className="-mt-1 mb-1 flex items-center gap-1.5 pl-[42px] text-[11px] text-text-muted">
                {gateTag(gate)}
                <span>{L.approved}</span>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  onClick={() =>
                    askInChat(
                      gateReference(
                        { topics: guide.topics, chip: guide.chip, prefix: guide.changePrefix },
                        gate,
                        st.gateStep as number,
                      ),
                    )
                  }
                  aria-label={fillTemplate(guide.changeLabel, { topic })}
                  data-testid={`gate-change-${gate}`}
                  className="rounded px-0.5 font-medium text-brand-text underline-offset-2 hover:underline"
                >
                  {guide.change}
                </button>
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
      <nav aria-label={L.title} className="rounded-lg border border-border bg-surface px-1 py-1.5">
        {list}
      </nav>
    );
  }

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <div className="shrink-0 border-b border-border px-4 pb-3 pt-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-text">{L.title}</h2>
          <span className="text-xs text-text-muted">{L.phaseOf(step, phaseCount)}</span>
        </div>
        <div
          className="mt-2 h-1 overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={L.title}
        >
          <span className="block h-full rounded-full bg-brand" style={{ width: `${progress}%` }} />
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
