"use client";

import { useState } from "react";
import type { GateStatus } from "@/lib/sessions";
import {
  allGatesApproved,
  stageState as stageStateFor,
  type StageState,
} from "@/lib/gate-timeline-state";
import { Icon } from "./icons";

type Props = {
  locale: "fi" | "en";
  step: number;
  phases: string[];
  gateSteps: number[];
  gateStatus: Record<number, GateStatus>;
  phaseCount: number;
  /** "aside": the column beside the workspace (lg and up); "inline": a card
   *  under the step's title on a narrower screen. */
  variant?: "aside" | "inline";
};

type Stage = {
  steps: { step: number; name: string }[];
  gateStep: number | null;
  gateName: string | null;
};

const LABELS = {
  en: {
    title: "Steps",
    phaseOf: (a: number, b: number) => `Step ${a} / ${b}`,
    toGate: (n: number) =>
      n <= 0
        ? "At the checkpoint: approve it to continue"
        : `${n} step${n === 1 ? "" : "s"} to the next checkpoint`,
    allApproved: "All checkpoints approved",
    checkpoint: "approval",
    approved: "Approved",
    locked: "Locked",
    now: "Now",
    rejected: "Rejected",
    stepsDone: (done: number, all: number) => `${done}/${all} steps`,
    // What each gate approves, so "Gate 2" says something to a business user.
    topics: ["Requirements", "Solution design", "Test run", "Handover"],
  },
  fi: {
    title: "Vaiheet",
    phaseOf: (a: number, b: number) => `Vaihe ${a} / ${b}`,
    toGate: (n: number) =>
      n <= 0
        ? "Tarkastuspisteessä: hyväksy jatkaaksesi"
        : `${n} ${n === 1 ? "vaihe" : "vaihetta"} seuraavaan tarkastuspisteeseen`,
    allApproved: "Kaikki tarkastuspisteet hyväksytty",
    checkpoint: "hyväksyntä",
    approved: "Hyväksytty",
    locked: "Lukittu",
    now: "Nyt",
    rejected: "Hylätty",
    stepsDone: (done: number, all: number) => `${done}/${all} vaihetta`,
    topics: ["Vaatimukset", "Ratkaisun rakenne", "Testiajo", "Luovutus"],
  },
} as const;

/**
 * The phases grouped by the gate that closes them. Compact on purpose: it used
 * to take 320 px for a "where you are" card, hexagon badges and status pills,
 * a quarter of a 1366 px screen next to the workspace and the chat.
 */
export function GateTimeline({
  locale,
  step,
  phases,
  gateSteps,
  gateStatus,
  phaseCount,
  variant = "aside",
}: Props) {
  const L = LABELS[locale];

  // Group the phases: each stage ends at its gate (the checkpoint).
  const stages: Stage[] = [];
  let cur: { step: number; name: string }[] = [];
  phases.forEach((name, i) => {
    const s = i + 1;
    if (gateSteps.includes(s)) {
      stages.push({ steps: cur, gateStep: s, gateName: name });
      cur = [];
    } else {
      cur.push({ step: s, name });
    }
  });
  if (cur.length) stages.push({ steps: cur, gateStep: null, gateName: null });

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

  const nextGate = gateSteps.find((g) => g >= step) ?? phaseCount;
  const toGateN = Math.max(0, nextGate - step);
  const finished = allGatesApproved(step, gateSteps, gateStatus);
  const progress = Math.round(((step - 1) / (phaseCount - 1)) * 100);

  return (
    <aside
      className={
        variant === "inline"
          ? // No taller than most of the screen: with every stage open the
            // card pushed the step's view out of a phone's window, and the
            // list scrolls inside instead.
            "flex max-h-[60dvh] flex-col rounded-lg border border-border bg-surface"
          : "hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex"
      }
    >
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
        <p className="mt-2 flex items-start gap-1.5 text-xs text-text-muted">
          <Icon
            name={finished ? "circleCheck" : "flag"}
            size={13}
            className={`mt-px ${finished ? "text-brand-strong" : ""}`}
          />
          <span>{finished ? L.allApproved : L.toGate(toGateN)}</span>
        </p>
      </div>

      <nav aria-label={L.title} className="scroll-thin relative min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <ol className="space-y-0.5">
          {stages.map((st, idx) => {
            const state = stageState(st);
            const isCollapsed = collapsed[idx] ?? autoCollapsed(st);
            const gs = st.gateStep ? gateStatus[st.gateStep] : undefined;
            const gateIdx = st.gateStep ? gateSteps.indexOf(st.gateStep) : -1;
            const topic = gateIdx >= 0 ? L.topics[gateIdx] : "";
            const done = st.steps.filter((s) => s.step < step).length;
            const sub =
              state === "approved"
                ? L.approved
                : state === "current"
                  ? L.stepsDone(Math.min(done, st.steps.length), st.steps.length)
                  : L.locked;
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
                    {state === "approved" ? <Icon name="check" size={13} /> : gateIdx + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[13px] ${
                        state === "current" ? "font-semibold text-text" : "font-medium text-text-secondary"
                      }`}
                    >
                      {st.gateName}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {state === "current" && topic ? `${topic} · ${sub}` : topic || sub}
                    </span>
                  </span>
                  {state === "pending" && <Icon name="lock" size={13} className="text-text-muted" />}
                  <Icon
                    name="chevronDown"
                    size={14}
                    className={`text-text-muted transition-transform duration-150 ${isCollapsed ? "-rotate-90" : ""}`}
                  />
                </button>

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
                          className={`min-w-0 flex-1 truncate ${
                            atGate && state === "current" ? "font-semibold text-brand-text" : "text-text-secondary"
                          }`}
                        >
                          {st.gateName} – {L.checkpoint}
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
      </nav>
    </aside>
  );
}
