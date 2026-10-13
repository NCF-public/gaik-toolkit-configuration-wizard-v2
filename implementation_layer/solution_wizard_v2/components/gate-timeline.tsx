"use client";

import { useState } from "react";
import type { GateStatus } from "@/lib/sessions";

type Props = {
  locale: "fi" | "en";
  step: number;
  phases: string[];
  gateSteps: number[];
  gateStatus: Record<number, GateStatus>;
  phaseCount: number;
};

type Stage = {
  steps: { step: number; name: string }[];
  gateStep: number | null;
  gateName: string | null;
};

const GATE_BADGE: Record<GateStatus, string> = {
  locked: "bg-neutral-bg border border-neutral-border text-neutral-text",
  pending: "bg-warning-bg border border-warning-border text-warning-text",
  approved: "bg-brand-soft border border-brand-soft-border text-brand-text",
  rejected: "bg-danger-bg border border-danger-border text-danger-text",
};

export function GateTimeline({
  locale,
  step,
  phases,
  gateSteps,
  gateStatus,
  phaseCount,
}: Props) {
  const L =
    locale === "en"
      ? {
          eyebrow: "Progress",
          title: "Phase timeline",
          collapse: "Collapse all",
          expand: "Expand all",
          now: "Where you are",
          phaseOf: (a: number, b: number) => `Phase ${a} / ${b}`,
          group: "group",
          toGate: (n: number) =>
            n <= 0
              ? "Checkpoint ahead"
              : `${n} step${n === 1 ? "" : "s"} to the next checkpoint`,
          checkpoint: "Checkpoint",
          approved: "Approved",
          current: "In progress",
          locked: "Locked",
          ahead: "Ahead",
          rejected: "Rejected",
          done: "Done",
        }
      : {
          eyebrow: "Eteneminen",
          title: "Vaihe-aikajana",
          collapse: "Tiivistä kaikki",
          expand: "Laajenna kaikki",
          now: "Missä olet nyt",
          phaseOf: (a: number, b: number) => `Vaihe ${a} / ${b}`,
          group: "ryhmä",
          toGate: (n: number) =>
            n <= 0
              ? "Tarkastuspiste edessä"
              : `${n} vaihetta seuraavaan tarkastuspisteeseen`,
          checkpoint: "Tarkastuspiste",
          approved: "Hyväksytty",
          current: "Käynnissä",
          locked: "Lukittu",
          ahead: "Edessä",
          rejected: "Hylätty",
          done: "valmis",
        };

  // Rakenna staget: kerää vaiheet, sulje gate-askeleeseen (= tarkastuspiste)
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
  const stageState = (st: Stage): "approved" | "current" | "pending" => {
    const { first, last } = stageBounds(st);
    if (step > last) return "approved";
    if (step >= first && step <= last) return "current";
    return "pending";
  };

  const [collapsed, setCollapsed] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    stages.forEach((st, idx) => {
      init[idx] = stageState(st) !== "current";
    });
    return init;
  });
  const [allCollapsed, setAllCollapsed] = useState(false);

  const toggle = (idx: number) =>
    setCollapsed((c) => ({ ...c, [idx]: !c[idx] }));
  const toggleAll = () => {
    const next = !allCollapsed;
    setAllCollapsed(next);
    const map: Record<number, boolean> = {};
    stages.forEach((_, idx) => (map[idx] = next));
    setCollapsed(map);
  };

  const nextGate = gateSteps.find((g) => g >= step) ?? phaseCount;
  const toGateN = Math.max(0, nextGate - step);
  const nowPhase = phases[step - 1] ?? "";
  const groupIdx = stages.findIndex((st) => stageState(st) === "current");
  const groupName =
    groupIdx >= 0 && stages[groupIdx].gateName
      ? stages[groupIdx].gateName!.replace(/\s*—.*/, "")
      : "";

  return (
    <aside className="w-80 shrink-0 flex flex-col min-h-0 bg-surface border-r border-border">
      {/* Otsikko */}
      <div className="shrink-0 px-[18px] pt-3.5 pb-3 border-b border-border">
        <div className="text-[11px] font-bold tracking-wide uppercase text-gold">
          {L.eyebrow}
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <h2 className="text-[15px] font-bold text-text">{L.title}</h2>
          <button
            onClick={toggleAll}
            className="text-[11px] text-text-muted hover:text-brand-strong transition-colors"
          >
            {allCollapsed ? L.expand : L.collapse}
          </button>
        </div>
      </div>

      {/* "Missä olet nyt" -kortti */}
      <div className="relative mx-[18px] mt-3 mb-1 shrink-0 overflow-hidden rounded-[10px] border border-gold/40 bg-gradient-to-b from-gold/[0.14] to-gold/[0.05] px-3.5 py-3">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gold">
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-gold motion-safe:animate-ping opacity-70" />
            <span className="relative h-2 w-2 rounded-full bg-gold" />
          </span>
          {L.now}
        </div>
        <div className="mt-1.5 text-[17px] font-bold text-text leading-tight">
          {nowPhase}
        </div>
        <div className="mt-0.5 text-xs text-text-muted">
          {L.phaseOf(step, phaseCount)}
          {groupName ? ` · ${groupName}` : ""}
        </div>
        <div className="mt-2.5 flex items-center gap-2 text-[11.5px] font-medium text-text">
          <span className="text-gold" aria-hidden>
            ⚑
          </span>
          <span>{L.toGate(toGateN)}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-gold to-gold-strong"
            style={{
              width: `${Math.round(((step - 1) / (phaseCount - 1)) * 100)}%`,
            }}
          />
        </div>
      </div>

      {/* Aikajana */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-6 pt-2.5">
        {stages.map((st, idx) => {
          const state = stageState(st);
          const isCollapsed = collapsed[idx];
          const gs = st.gateStep ? gateStatus[st.gateStep] : undefined;
          const stageLabel =
            state === "approved"
              ? L.approved
              : state === "current"
                ? L.current
                : L.locked;
          const stageLabelCls =
            state === "approved"
              ? "bg-brand-soft text-brand-text"
              : state === "current"
                ? "bg-gold-soft text-gold"
                : "bg-black/[0.05] text-text-muted";
          return (
            <div key={idx} className="mt-1.5">
              {idx > 0 && (
                <div
                  className={`ml-10 h-3.5 w-0.5 ${
                    state === "approved" || stageState(stages[idx - 1]) === "approved"
                      ? "bg-brand"
                      : "bg-border-strong"
                  }`}
                />
              )}

              {/* Stage-otsikko */}
              <button
                onClick={() => toggle(idx)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left hover:bg-surface-muted transition-colors"
              >
                <span
                  className={`relative flex h-[34px] w-[30px] shrink-0 items-center justify-center ${
                    state === "current"
                      ? "drop-shadow-[0_1px_3px_rgba(17,27,40,0.2)]"
                      : ""
                  }`}
                >
                  <span
                    className={`hex absolute inset-0 ${
                      state === "approved"
                        ? "bg-brand"
                        : state === "current"
                          ? "bg-gold"
                          : "bg-border-strong"
                    }`}
                  />
                  <span
                    className={`hex absolute inset-0.5 ${
                      state === "approved"
                        ? "bg-brand"
                        : state === "current"
                          ? "bg-gold"
                          : "bg-surface"
                    }`}
                  />
                  <span
                    className={`relative z-[1] text-xs font-bold ${
                      state === "approved"
                        ? "text-on-brand"
                        : state === "current"
                          ? "text-on-gold"
                          : "text-text-muted"
                    }`}
                  >
                    {st.gateStep ? gateSteps.indexOf(st.gateStep) + 1 : "•"}
                  </span>
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold text-text truncate">
                    {st.gateName ? st.gateName : nowPhase}
                  </span>
                  <span className="block text-[11px] text-text-muted mt-px">
                    {st.steps.length}{" "}
                    {locale === "en"
                      ? st.steps.length === 1
                        ? "step"
                        : "steps"
                      : "vaihetta"}
                    {state === "current"
                      ? ` · ${st.steps.filter((s) => s.step < step).length}/${st.steps.length}`
                      : ""}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-[7px] py-[3px] text-[9px] font-bold uppercase tracking-wide ${stageLabelCls}`}
                >
                  {stageLabel}
                </span>
                <span
                  className={`shrink-0 text-text-muted text-[13px] transition-transform ${
                    isCollapsed ? "-rotate-90" : ""
                  }`}
                  aria-hidden
                >
                  ▾
                </span>
              </button>

              {/* Stage-runko */}
              {!isCollapsed && (
                <div>
                  <div className="relative ml-[25px] mt-0.5 mb-1.5 pl-[22px]">
                    <span
                      className={`absolute left-0 top-1 bottom-2 w-0.5 rounded ${
                        state === "approved" ? "bg-brand" : "bg-border-strong"
                      }`}
                    />
                    {st.steps.map((s) => {
                      const done = s.step < step;
                      const isCur = s.step === step;
                      return (
                        <div
                          key={s.step}
                          className="relative flex items-center gap-2 rounded-md px-1 py-[7px]"
                        >
                          <span
                            className={`absolute -left-[27px] top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full border-2 z-[1] ${
                              done
                                ? "bg-brand border-brand"
                                : isCur
                                  ? "bg-gold border-gold shadow-[0_0_0_4px_rgba(138,35,135,0.22)]"
                                  : "bg-surface border-border-strong"
                            }`}
                          />
                          <span
                            className={`text-[12.5px] ${
                              isCur
                                ? "text-gold font-semibold"
                                : done
                                  ? "text-text"
                                  : "text-text-muted"
                            }`}
                          >
                            {s.name}
                          </span>
                          {done && (
                            <span className="text-[10px] text-brand-strong" aria-hidden>
                              ✓
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Gate-tarkastuspiste stagen perässä */}
                  {st.gateStep && (
                    <div className="ml-[25px] mb-1 pl-[22px]">
                      <div
                        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 ${
                          state === "approved"
                            ? "border-brand-soft-border bg-brand-soft"
                            : state === "current"
                              ? "border-gold/60 bg-gold/[0.08]"
                              : "border-dashed border-border-strong bg-surface-muted"
                        }`}
                      >
                        <span
                          className={`text-base ${
                            state === "approved"
                              ? "text-brand-strong"
                              : state === "current"
                                ? "text-gold"
                                : "text-text-muted"
                          }`}
                          aria-hidden
                        >
                          {state === "approved" ? "✓" : state === "current" ? "⚑" : "🔒"}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-bold text-text">
                            {st.gateName} — {L.checkpoint}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-[7px] py-[3px] text-[9px] font-bold uppercase ${
                            gs ? GATE_BADGE[gs] : "bg-black/[0.05] text-text-muted"
                          }`}
                        >
                          {state === "approved"
                            ? L.approved
                            : state === "current"
                              ? L.ahead
                              : L.locked}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
