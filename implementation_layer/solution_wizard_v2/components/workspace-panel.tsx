"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState } from "react";
import type { Blueprint, BlueprintStepType } from "@/lib/mock-sessions";
import { nextTabForStepChange } from "@/lib/workspace-tab-follow";
import { NO_POC_PACKAGE, pocPackageState } from "@/lib/poc-package-state";
import {
  NO_PREFLIGHT,
  preflightOutcome,
  shouldStartPreflight,
  type PreflightState,
} from "@/lib/poc-preflight";
import type { Dict } from "@/lib/i18n";
import { shouldShowBpmnSpike } from "@/lib/bpmn-spike";
import { BlueprintJsonEditor } from "@/components/blueprint-json-editor";
import { SolutionPlanView } from "@/components/solution-plan-view";

const BpmnDiagramPanel = dynamic(
  () =>
    import("@/components/bpmn-diagram-panel").then((m) => ({
      default: m.BpmnDiagramPanel,
    })),
  { ssr: false },
);

const TYPE_STYLE: Record<BlueprintStepType, string> = {
  io: "bg-surface-muted/50 backdrop-blur-sm text-text-secondary border-border border-l-4 border-l-step-io",
  ai: "bg-surface-muted/50 backdrop-blur-sm text-text-secondary border-border border-l-4 border-l-step-ai",
  human_review:
    "bg-surface-muted/50 backdrop-blur-sm text-text-secondary border-border border-l-4 border-l-step-human",
};

function StepListFlow({
  blueprint,
  t,
  typeLabel,
}: {
  blueprint: Blueprint;
  t: Dict;
  typeLabel: Record<BlueprintStepType, string>;
}) {
  return (
    <>
      {blueprint.goal && (
        <p className="text-sm leading-relaxed text-text-secondary mb-4">
          <span className="font-medium text-text-strong">
            {t.wsBlueprintGoal}:
          </span>{" "}
          {blueprint.goal}
        </p>
      )}
      <ol>
        {blueprint.steps.map((s, i) => (
          <li key={s.id}>
            <div
              className={`rounded-lg border px-3 py-2.5 shadow-xs ${TYPE_STYLE[s.type]}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{s.name}</span>
                <span className="text-xs font-semibold uppercase tracking-wide opacity-70">
                  {typeLabel[s.type]}
                  {s.component ? ` · ${s.component}` : ""}
                </span>
              </div>
              {s.description && (
                <p className="text-xs opacity-80 mt-0.5">{s.description}</p>
              )}
            </div>
            {i < blueprint.steps.length - 1 && (
              <div className="mx-auto h-4 w-px bg-border" aria-hidden />
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

function WorkflowFlowTab({
  sessionId,
  sessionTitle,
  wizardStep,
  blueprint,
  bpmnRefreshKey,
  onBlueprintChange,
  t,
  typeLabel,
}: {
  sessionId: string;
  sessionTitle: string;
  wizardStep: number;
  blueprint: Blueprint;
  bpmnRefreshKey: number;
  onBlueprintChange: (blueprint: Blueprint) => void;
  t: Dict;
  typeLabel: Record<BlueprintStepType, string>;
}) {
  const showBpmn = shouldShowBpmnSpike(sessionId, wizardStep);
  const [bpmnXml, setBpmnXml] = useState<string | null>(null);
  const [loading, setLoading] = useState(showBpmn);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    if (!showBpmn) {
      setBpmnXml(null);
      setFetchError(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchError(false);

    fetch(`/api/sessions/${sessionId}/bpmn`)
      .then((res) => {
        if (!res.ok) throw new Error("bpmn unavailable");
        return res.text();
      })
      .then((xml) => {
        if (!cancelled) setBpmnXml(xml);
      })
      .catch(() => {
        if (!cancelled) setFetchError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, showBpmn, bpmnRefreshKey]);

  if (!showBpmn) {
    return (
      <StepListFlow blueprint={blueprint} t={t} typeLabel={typeLabel} />
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-2">
      {loading && (
        <p className="text-sm text-text-muted">{t.wsBpmnLoading}</p>
      )}
      {fetchError && (
        <p className="text-sm text-danger-text" role="alert">
          {t.wsBpmnError}
        </p>
      )}

      {bpmnXml && !fetchError && (
        <BpmnDiagramPanel
          sessionId={sessionId}
          xml={bpmnXml}
          ariaLabel={t.wsTabFlow}
          loadErrorLabel={t.wsBpmnError}
          editableLabel={t.wsBpmnEditable}
          dialogTitle={sessionTitle}
          hintLabel={t.wsBpmnInlineHint}
          saveLabel={t.wsBpmnSave}
          savingLabel={t.wsBpmnSaving}
          saveErrorLabel={t.wsBpmnSaveError}
          savedLabel={t.wsBpmnSaved}
          activeBlueprintLabel={t.activeBlueprint}
          lintBlockedLabel={t.wsBpmnLintBlocked}
          lintWarningsLabel={t.wsBpmnLintWarnings}
          zoomInLabel={t.wsBpmnZoomIn}
          zoomOutLabel={t.wsBpmnZoomOut}
          overviewLabel={t.wsBpmnOverview}
          readableLabel={t.wsBpmnReadable}
          toolbarLabel={t.wsBpmnToolbar}
          themeLabel={t.wsBpmnThemeLabel}
          themeLightLabel={t.wsBpmnThemeLight}
          themeDarkLabel={t.wsBpmnThemeDark}
          themeGaikLabel={t.wsBpmnThemeGaik}
          v2StartedLabel={t.wsBpmnV2Started}
          propertiesTitle={t.wsBpmnPropertiesTitle}
          propertiesEmpty={t.wsBpmnPropertiesEmpty}
          propertiesName={t.wsBpmnPropertiesName}
          propertiesType={t.wsBpmnPropertiesType}
          propertiesId={t.wsBpmnPropertiesId}
          onLocalStepNameChange={(stepId, nextName) => {
            onBlueprintChange({
              ...blueprint,
              steps: blueprint.steps.map((s) =>
                s.id === stepId ? { ...s, name: nextName } : s,
              ),
            });
          }}
          onSynced={({ blueprint: synced, xml }) => {
            onBlueprintChange(synced);
            setBpmnXml(xml);
          }}
        />
      )}

      <details className="shrink-0 rounded-lg border border-border bg-surface-muted/40 px-3 py-2">
        <summary className="text-sm font-medium text-text-secondary cursor-pointer">
          {t.wsTabFlow} — mock step list
        </summary>
        <div className="mt-3 max-h-48 overflow-auto">
          <StepListFlow blueprint={blueprint} t={t} typeLabel={typeLabel} />
        </div>
      </details>

      <p className="shrink-0 text-xs text-text-muted">{t.wsBpmnSpikeNote}</p>
    </div>
  );
}

type Tab = "flow" | "json" | "plan" | "poc";
type PocStatus = "idle" | "running" | "success" | "failed";
/** A sandbox run's own lifecycle, reported by wizard_api — not derived here. */
type RunPhase =
  | "idle"
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "timeout"
  | "error";

/** A long run can print a lot; keep the tail rather than the whole history. */
const MAX_LOG_LINES = 2000;

const TABS: Tab[] = ["flow", "json", "plan", "poc"];

export function WorkspacePanel({
  sessionId,
  sessionTitle,
  wizardStep,
  blueprint: initialBlueprint,
  hasSuccessfulRun = false,
  t,
}: {
  sessionId: string;
  sessionTitle: string;
  wizardStep: number;
  blueprint: Blueprint;
  /** wizard_api has recorded a successful sandbox run (#143); opens the deployable download. */
  hasSuccessfulRun?: boolean;
  t: Dict;
}) {
  const [tab, setTab] = useState<Tab>("flow");
  const [blueprint, setBlueprint] = useState(initialBlueprint);
  const [bpmnRefreshKey, setBpmnRefreshKey] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [pocStatus, setPocStatus] = useState<PocStatus>("idle");
  // Files the agent's PoC scaffolder produced (null = not yet loaded).
  const [pocGenerated, setPocGenerated] = useState(false);
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [runMessage, setRunMessage] = useState<string | null>(null);
  // True once the Job exists: an error after that is "following the run was
  // interrupted", not "the run could not be started".
  const [runStarted, setRunStarted] = useState(false);
  const [runLogs, setRunLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const [pocFiles, setPocFiles] = useState<string[]>([]);
  // `ready`/`problems` come from the api's package check; see lib/poc-package-state.
  const [pocReady, setPocReady] = useState(false);
  const [pocProblems, setPocProblems] = useState<string[]>([]);
  // Sample input files in the package (#95), and whether a run has been
  // recorded as successful (#143) — the api gates the deployable package on
  // that, so the download is offered only then. Starts from the server's
  // knowledge and flips when a run in this view ends in "succeeded".
  const [pocInputs, setPocInputs] = useState<{ name: string; bytes: number }[]>([]);
  const [inputBusy, setInputBusy] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [runRecorded, setRunRecorded] = useState(hasSuccessfulRun);
  // Bumped when a run ends so the package state (and with it the recorded run)
  // is re-read from the api instead of trusted from the stream's last frame.
  const [pocRefresh, setPocRefresh] = useState(0);
  // The preflight (#252): one sandbox check per package version, run by itself.
  const [pocVersion, setPocVersion] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PreflightState>(NO_PREFLIGHT);
  const checkedVersionRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const baseId = useId();

  // Chat runs its own turns (router.refresh() after each message) and can carry the
  // session past a milestone — BPMN generated, PoC reached — without the user ever
  // touching this panel. Left alone, the tab just sits wherever it was clicked last, so
  // a finished PoC could go completely unseen (#138, raised directly by a customer
  // reviewer: "the chat and this user interface are not in sync"). The milestone logic
  // itself lives in lib/workspace-tab-follow.ts.
  const prevStepRef = useRef(wizardStep);
  useEffect(() => {
    const next = nextTabForStepChange(prevStepRef.current, wizardStep);
    if (next) setTab(next);
    prevStepRef.current = wizardStep;
  }, [wizardStep]);

  // When the PoC tab is open, load the generated file list. Re-runs after a
  // simulated run so a freshly generated PoC appears without a reload.
  useEffect(() => {
    if (tab !== "poc") return;
    let cancelled = false;
    fetch(`/api/sessions/${sessionId}/poc/files`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : NO_POC_PACKAGE))
      .then((d: unknown) => {
        if (cancelled) return;
        const state = pocPackageState(d);
        setPocGenerated(state.generated);
        setPocReady(state.ready);
        setPocProblems(state.problems);
        setPocFiles(state.files);
        setPocVersion(state.version);
        // The api's word on whether a run is recorded (#253). The server page
        // seeded this from the same field; a mock/older answer leaves it alone.
        if (typeof d === "object" && d !== null && "recordedRun" in d) {
          setRunRecorded(Boolean(state.recordedRun));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPocGenerated(false);
          setPocReady(false);
          setPocProblems([]);
          setPocFiles([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, sessionId, pocStatus, pocRefresh]);

  // The preflight (#252): as soon as a package is ready, and again whenever the
  // agent rewrites it, a sandbox Job imports what run_poc.py imports, builds each
  // stage's model config and loads the schema. It calls no model, so it needs no
  // input; what it finds is what would have failed the first run.
  useEffect(() => {
    if (
      !shouldStartPreflight({
        onPocTab: tab === "poc",
        ready: pocGenerated && pocReady,
        version: pocVersion,
        checkedVersion: checkedVersionRef.current,
      })
    ) {
      return;
    }
    const version = pocVersion as string;
    checkedVersionRef.current = version;
    void (async () => {
      setPreflight({ phase: "running", version, problems: [] });
      const lines: string[] = [];
      try {
        const started = await fetch(`/api/sessions/${sessionId}/poc/check`, { method: "POST" });
        const body = await started.json().catch(() => ({}));
        // 409 (not complete yet) and 503 (no sandbox here) are not findings
        // about the package, so they show nothing.
        if (!started.ok || typeof body.run_id !== "string") {
          if (checkedVersionRef.current === version) setPreflight(NO_PREFLIGHT);
          return;
        }
        const res = await fetch(`/api/sessions/${sessionId}/runs/${body.run_id}/stream`);
        if (!res.ok || !res.body) throw new Error("stream failed");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let phase = "failed";
        let message: string | null = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.startsWith("data: ") ? frame.slice(6) : frame;
            if (!line.trim()) continue;
            const evt = JSON.parse(line);
            if (typeof evt.log === "string") lines.push(evt.log);
            if (evt.error) {
              phase = "failed";
              message = evt.message ?? null;
            }
            if (evt.done) {
              phase = evt.phase ?? "failed";
              message = evt.message ?? null;
            }
          }
        }
        const outcome = preflightOutcome(phase, lines, message);
        if (checkedVersionRef.current === version) setPreflight({ ...outcome, version });
      } catch {
        if (checkedVersionRef.current === version) setPreflight(NO_PREFLIGHT);
      }
    })();
  }, [tab, sessionId, pocGenerated, pocReady, pocVersion]);

  // The package's sample input, listed with the files: a document PoC run from
  // here stopped at "No PDF files found in sample_input" until someone put a
  // file there out of band (#239).
  useEffect(() => {
    if (tab !== "poc" || !pocGenerated) return;
    let cancelled = false;
    fetch(`/api/sessions/${sessionId}/poc/input`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((d: { files?: { name: string; bytes: number }[] }) => {
        if (!cancelled) setPocInputs(Array.isArray(d.files) ? d.files : []);
      })
      .catch(() => {
        if (!cancelled) setPocInputs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, sessionId, pocStatus, pocGenerated]);

  const tabLabels: Record<Tab, string> = {
    flow: t.wsTabFlow,
    json: t.wsTabJson,
    plan: t.wsTabPlan,
    poc: t.wsTabPoc,
  };

  const typeLabel: Record<BlueprintStepType, string> = {
    io: t.wsStepIo,
    ai: t.wsStepAi,
    human_review: t.wsStepHuman,
  };

  /** Start a sandbox run and follow it (#94). Nothing here simulates: a run
   * that did not happen cannot report that it did. */
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [runLogs.length, logs.length]);

  async function runInSandbox() {
    setRunPhase("pending");
    setRunMessage(null);
    setRunStarted(false);
    setRunLogs([]);

    let runId: string;
    // Local, not the state: the state read in this closure is the value from
    // before setRunStarted(true), so the messages below would still say
    // "could not be started" for a run that had started (#228).
    let started = false;
    try {
      const response = await fetch(`/api/sessions/${sessionId}/runs`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRunPhase("error");
        setRunMessage(body?.detail?.message ?? body?.message ?? t.pocRunError);
        return;
      }
      runId = body.run_id;
      started = true;
      setRunStarted(true);
    } catch {
      setRunPhase("error");
      setRunMessage(t.pocRunError);
      return;
    }

    setRunPhase("running");
    try {
      const res = await fetch(`/api/sessions/${sessionId}/runs/${runId}/stream`);
      if (!res.ok || !res.body) throw new Error("stream failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.startsWith("data: ") ? frame.slice(6) : frame;
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (typeof evt.log === "string") {
            setRunLogs((prev) => {
              const next = [...prev, evt.log];
              return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
            });
          }
          if (evt.error) {
            setRunPhase("error");
            setRunMessage(evt.message ?? (started ? t.pocRunInterrupted : t.pocRunError));
            return;
          }
          if (evt.done) {
            setRunPhase((evt.phase as RunPhase) ?? "failed");
            if (evt.message) setRunMessage(evt.message);
            // Not trusted for the deployable download: the api records the run
            // on this frame, but a concurrent metadata write may lose the record
            // (#253). Re-read the package state and let the api say.
            setPocRefresh((n) => n + 1);
          }
        }
      }
    } catch {
      setRunPhase("error");
      setRunMessage(started ? t.pocRunInterrupted : t.pocRunError);
    }
  }

  async function uploadInput(file: File) {
    setInputBusy(true);
    setInputError(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const res = await fetch(`/api/sessions/${sessionId}/poc/input`, {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = body?.detail;
        setInputError(typeof detail === "string" ? detail : detail?.message ?? t.pocInputFailed);
        return;
      }
      setPocInputs((prev) => [
        ...prev.filter((f) => f.name !== body.name),
        { name: body.name as string, bytes: body.bytes as number },
      ]);
    } catch {
      setInputError(t.pocInputFailed);
    } finally {
      setInputBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeInput(name: string) {
    setInputBusy(true);
    setInputError(null);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/poc/input/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
      if (res.status === 204 || res.status === 404) {
        setPocInputs((prev) => prev.filter((f) => f.name !== name));
      } else {
        setInputError(t.pocInputFailed);
      }
    } catch {
      setInputError(t.pocInputFailed);
    } finally {
      setInputBusy(false);
    }
  }

  // A run's own output takes over the terminal once one has started; before
  // that it shows what generation printed.
  const shownLogs = runPhase === "idle" ? logs : runLogs;

  const RUN_PHASE_LABEL: Record<RunPhase, string> = {
    idle: "",
    pending: t.pocPhasePending,
    running: t.pocPhaseRunning,
    succeeded: t.pocPhaseSucceeded,
    failed: t.pocPhaseFailed,
    timeout: t.pocPhaseTimeout,
    error: runStarted ? t.pocRunInterrupted : t.pocRunError,
  };

  const runActive = runPhase === "pending" || runPhase === "running";

  async function runPoc() {
    // Not while a run is streaming: its done frame would flip the terminal
    // back to the run log mid-generation, and an idle phase would re-enable
    // the Run button beside a Job still going.
    if (runActive) return;
    setPocStatus("running");
    setLogs([]);
    // Generation takes the terminal back from an earlier run: otherwise its
    // lines, including the failure reason, stay hidden behind the old run's
    // log (#228).
    setRunPhase("idle");
    setRunStarted(false);
    setRunLogs([]);
    setRunMessage(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/poc`, {
        method: "POST",
      });
      if (!res.ok || !res.body) throw new Error("poc failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.startsWith("data: ") ? frame.slice(6) : frame;
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.log) setLogs((prev) => [...prev, evt.log]);
          if (evt.done)
            setPocStatus(evt.status === "success" ? "success" : "failed");
        }
      }
    } catch {
      setPocStatus("failed");
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        role="tablist"
        aria-label={t.workspace}
        className="shrink-0 mb-4 inline-flex items-center gap-0.5 rounded-lg bg-surface-muted border border-border p-0.5"
      >
        {TABS.map((key) => {
          const tabId = `${baseId}-tab-${key}`;
          const panelId = `${baseId}-panel-${key}`;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={tabId}
              aria-selected={tab === key}
              aria-controls={panelId}
              onClick={() => setTab(key)}
              className={tab === key ? "tab-btn-active" : "tab-btn-inactive"}
            >
              {tabLabels[key]}
            </button>
          );
        })}
      </div>

      {TABS.map((key) => {
        const tabId = `${baseId}-tab-${key}`;
        const panelId = `${baseId}-panel-${key}`;
        return (
          <div
            key={key}
            role="tabpanel"
            id={panelId}
            aria-labelledby={tabId}
            hidden={tab !== key}
            className="flex-1 min-h-0 overflow-y-auto"
          >
            {key === "flow" && tab === "flow" && (
              <WorkflowFlowTab
                  sessionId={sessionId}
                  sessionTitle={sessionTitle}
                  wizardStep={wizardStep}
                  blueprint={blueprint}
                  bpmnRefreshKey={bpmnRefreshKey}
                  onBlueprintChange={setBlueprint}
                  t={t}
                  typeLabel={typeLabel}
                />
            )}

            {key === "json" && (
              <BlueprintJsonEditor
                sessionId={sessionId}
                blueprint={blueprint}
                onSaved={(saved) => {
                  setBlueprint(saved);
                  setBpmnRefreshKey((k) => k + 1);
                }}
                t={t}
              />
            )}

            {key === "plan" && <SolutionPlanView blueprint={blueprint} t={t} />}

            {key === "poc" && (
              <div className="h-full flex flex-col min-h-0">
                {pocGenerated ? (
                  <div className="shrink-0 mb-4 rounded-lg border border-border bg-surface-muted p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className="text-sm font-semibold text-text">
                        {pocReady ? t.pocGeneratedTitle : t.pocNotReadyTitle}
                      </span>
                      {/* An incomplete package downloads and does nothing; the
                          api says so (ready: false), so the link is withheld. */}
                      {pocReady && (
                        <a
                          href={`/api/sessions/${sessionId}/poc/download`}
                          download
                          className="btn-brand text-sm"
                        >
                          {t.pocDownload}
                        </a>
                      )}
                    </div>
                    {!pocReady && pocProblems.length > 0 && (
                      <ul
                        className="mb-2 list-disc pl-5 text-xs text-danger-text"
                        data-testid="poc-problems"
                      >
                        {pocProblems.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    )}
                    {preflight.phase !== "idle" && (
                      <div
                        className="mb-2 text-xs"
                        data-testid="poc-check"
                        data-phase={preflight.phase}
                      >
                        <span
                          className={
                            preflight.phase === "failed" ? "text-danger-text" : "text-text-muted"
                          }
                        >
                          {preflight.phase === "running"
                            ? t.pocCheckRunning
                            : preflight.phase === "ok"
                              ? t.pocCheckOk
                              : t.pocCheckFailed}
                        </span>
                        {preflight.phase === "failed" && preflight.problems.length > 0 && (
                          <ul className="mt-1 list-disc pl-5 text-danger-text">
                            {preflight.problems.map((p) => (
                              <li key={p}>{p}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    <ul className="max-h-40 overflow-auto space-y-0.5 font-mono text-xs text-text-muted">
                      {pocFiles.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    {/* Sample input (#95): what the run reads. Without a file
                        here a document PoC fails at "No PDF files found". */}
                    <div className="mt-3 border-t border-border pt-3" data-testid="poc-inputs">
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <span className="text-xs font-semibold text-text">{t.pocInputsTitle}</span>
                        <label className={inputBusy ? "btn-ghost text-xs opacity-60" : "btn-ghost text-xs cursor-pointer"}>
                          {inputBusy ? t.pocInputUploading : t.pocInputUpload}
                          <input
                            ref={fileInputRef}
                            type="file"
                            className="sr-only"
                            disabled={inputBusy}
                            data-testid="poc-input-file"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void uploadInput(f);
                            }}
                          />
                        </label>
                      </div>
                      {pocInputs.length === 0 ? (
                        <p className="text-xs text-text-muted">{t.pocInputsEmpty}</p>
                      ) : (
                        <ul className="space-y-0.5 font-mono text-xs text-text-muted">
                          {pocInputs.map((f) => (
                            <li key={f.name} className="flex items-center justify-between gap-2">
                              <span>
                                sample_input/{f.name}{" "}
                                <span className="text-text-faint">({Math.max(1, Math.round(f.bytes / 1024))} kB)</span>
                              </span>
                              <button
                                type="button"
                                className="btn-ghost text-xs"
                                disabled={inputBusy}
                                onClick={() => void removeInput(f.name)}
                                aria-label={`${t.pocInputRemove} ${f.name}`}
                              >
                                {t.pocInputRemove}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {inputError && (
                        <p className="mt-1 text-xs text-danger-text" role="alert">
                          {inputError}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="shrink-0 mb-4 text-xs text-text-muted">
                    {t.pocNotGenerated}
                  </p>
                )}
                <div className="shrink-0 flex items-center gap-3 mb-3">
                  <button
                    type="button"
                    onClick={runPoc}
                    disabled={pocStatus === "running" || runActive}
                    className="btn-brand"
                  >
                    {pocStatus === "running"
                      ? t.pocRunning
                      : logs.length > 0
                        ? t.pocRerun
                        : t.pocRun}
                  </button>
                  {/* The real run, beside generation. Enabled only once a
                      package exists — a run with nothing to run is the state
                      the old simulated button reported as success. */}
                  <button
                    type="button"
                    onClick={runInSandbox}
                    disabled={!pocGenerated || !pocReady || runActive}
                    className="btn-secondary"
                    data-testid="poc-run-sandbox"
                  >
                    {runPhase === "running" || runPhase === "pending"
                      ? t.pocRunning2
                      : t.pocRunSandbox}
                  </button>
                  {/* The hand-over (#143): wizard_api serves this zip only after a
                      run it recorded as successful, so the link appears only then;
                      before that a disabled button says what has to happen. */}
                  {runRecorded && pocReady ? (
                    <a
                      href={`/api/sessions/${sessionId}/poc/deployable`}
                      download
                      className="btn-secondary"
                      data-testid="poc-deployable"
                    >
                      {t.pocDeployable}
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      title={t.pocDeployableHint}
                      className="btn-secondary"
                      data-testid="poc-deployable"
                    >
                      {t.pocDeployable}
                    </button>
                  )}
                  {pocReady && (
                    <a
                      href={`/sessions/${sessionId}/cases`}
                      className="btn-secondary"
                      title={t.pocOpenCasesHint}
                      data-testid="poc-open-cases"
                    >
                      {t.pocOpenCases}
                    </a>
                  )}
                  {runPhase !== "idle" && (
                    <span
                      data-testid="poc-run-phase"
                      className={
                        runPhase === "succeeded"
                          ? "badge-success"
                          : runPhase === "running" || runPhase === "pending"
                            ? "badge-muted"
                            : "badge-error"
                      }
                    >
                      {RUN_PHASE_LABEL[runPhase]}
                    </span>
                  )}
                  {pocStatus === "success" && (
                    <span className="badge-success">{t.pocSuccess}</span>
                  )}
                  {pocStatus === "failed" && (
                    <span className="badge bg-danger-bg border-danger-border text-danger-text">
                      {t.pocFailed}
                    </span>
                  )}
                </div>

                {/* Why the run ended the way it did, in the api's words. The state
                    was set for every error frame and never shown. */}
                {runMessage &&
                  (runPhase === "error" || runPhase === "failed" || runPhase === "timeout") && (
                    <p
                      className="shrink-0 mb-3 text-xs text-danger-text"
                      role="alert"
                      data-testid="poc-run-message"
                    >
                      {runMessage}
                    </p>
                  )}

                {shownLogs.length === 0 && pocStatus === "idle" && runPhase === "idle" ? (
                  <p className="text-xs text-text-muted">{t.pocIdle}</p>
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col">
                    <div className="h-7 flex items-center gap-1.5 px-3 bg-term-bar rounded-t-lg shrink-0">
                      <span className="h-2.5 w-2.5 rounded-full bg-white/15" aria-hidden />
                      <span className="h-2.5 w-2.5 rounded-full bg-white/15" aria-hidden />
                      <span className="h-2.5 w-2.5 rounded-full bg-white/15" aria-hidden />
                    </div>
                    <pre className="flex-1 overflow-auto bg-term-bg p-3.5 font-mono text-xs leading-5 text-term-text whitespace-pre-wrap rounded-b-lg ring-1 ring-inset ring-white/5">
                      {shownLogs.map((log, i) => {
                        const lower = log.toLowerCase();
                        const isErr =
                          lower.includes("error") ||
                          lower.includes("fail") ||
                          lower.includes("✗");
                        const isOk =
                          lower.includes("success") ||
                          lower.includes("✓") ||
                          lower.includes(" ok");
                        const cls = isErr
                          ? "text-term-err"
                          : isOk
                            ? "text-term-ok"
                            : "text-term-muted";
                        return (
                          <div key={i} className={cls}>
                            <span className="text-term-accent select-none mr-2">
                              ›
                            </span>
                            {log}
                          </div>
                        );
                      })}
                      <div ref={logEndRef} />
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
