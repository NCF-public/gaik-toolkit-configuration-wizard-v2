"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Blueprint, BlueprintStepType } from "@/lib/mock-sessions";
import { nextTabForStepChange } from "@/lib/workspace-tab-follow";
import { blueprintKey } from "@/lib/blueprint-sync";
import { NO_POC_PACKAGE, pocPackageState, samePocPackage } from "@/lib/poc-package-state";
import type { PocPackageState } from "@/lib/poc-package-state";
import { pocPollDelay } from "@/lib/poc-package-poll";
import { runLogLineFilter } from "@/lib/poc-run-log";
import {
  NO_PREFLIGHT,
  preflightOutcome,
  shouldStartPreflight,
  packageStatus,
  type PreflightState,
} from "@/lib/poc-preflight";
import { preflightRetryDelayMs } from "@/lib/sandbox-busy";
import type { Dict } from "@/lib/i18n";
import {
  documentSections,
  formatSize,
  hasRunOutput,
  pocRunOutput,
  runFileHref,
  recordRows,
  restoredRun,
  runEndMessage,
  type PocRunOutput,
} from "@/lib/poc-run-output";
import { shouldShowBpmnSpike } from "@/lib/bpmn-spike";
import { BlueprintJsonEditor } from "@/components/blueprint-json-editor";
import { SolutionPlanView } from "@/components/solution-plan-view";
import { Icon, type IconName } from "@/components/icons";

const BpmnDiagramPanel = dynamic(
  () =>
    import("@/components/bpmn-diagram-panel").then((m) => ({
      default: m.BpmnDiagramPanel,
    })),
  { ssr: false },
);

/** What kind of step it is, at a glance: data in or out, the model, a person. */
const TYPE_ICON: Record<BlueprintStepType, IconName> = {
  io: "arrowRightLeft",
  ai: "brain",
  human_review: "userCheck",
};

const TYPE_CHIP: Record<BlueprintStepType, string> = {
  io: "bg-surface-muted text-text-secondary",
  ai: "bg-brand-soft text-brand-text",
  human_review: "bg-warning-bg text-warning-text",
};

// The solution's steps in order: a numbered line of steps, each with what kind
// of step it is and which component runs it. It used to be a stack of boxes
// with coloured left edges and all-caps codes ("AI-VAIHE · PGVECTOR", "I/O").
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
        <p className="mb-4 text-sm leading-relaxed text-text-secondary">
          <span className="font-medium text-text-strong">{t.wsBlueprintGoal}:</span>{" "}
          {blueprint.goal}
        </p>
      )}
      <ol className="max-w-3xl">
        {blueprint.steps.map((s, i) => {
          const last = i === blueprint.steps.length - 1;
          return (
            <li key={s.id} className="flex gap-3">
              <div className="flex flex-col items-center" aria-hidden>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface text-xs font-semibold text-text-secondary">
                  {i + 1}
                </span>
                {!last && <span className="my-1 w-px flex-1 bg-border-strong" />}
              </div>
              <div className={`min-w-0 flex-1 ${last ? "" : "pb-3"}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
                  <span className="text-sm font-medium text-text">{s.name}</span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${TYPE_CHIP[s.type]}`}
                  >
                    <Icon name={TYPE_ICON[s.type]} size={12} />
                    {typeLabel[s.type]}
                    {s.component ? ` · ${s.component}` : ""}
                  </span>
                </div>
                {s.description && (
                  <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{s.description}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** One numbered step of the PoC tab: what it is, where it stands, its action. */
function StepCard({
  n,
  title,
  status,
  done = false,
  muted = false,
  actions,
  testId,
  children,
}: {
  n: number;
  title: string;
  status?: ReactNode;
  /** Ticked when the step's result exists; a step without one stays numbered. */
  done?: boolean;
  /** A step that cannot be taken yet. */
  muted?: boolean;
  actions?: ReactNode;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={`rounded-lg border border-border bg-surface ${muted ? "opacity-70" : ""}`}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
        <span
          className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            done ? "bg-brand text-on-brand" : "border border-border-strong text-text-secondary"
          }`}
          aria-hidden
        >
          {done ? <Icon name="check" size={13} /> : n}
        </span>
        <div className="min-w-[12rem] flex-1">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          {status && <div className="mt-0.5 text-xs leading-relaxed text-text-muted">{status}</div>}
        </div>
        {actions && <div className="flex w-full flex-wrap items-center gap-2 pl-9 sm:w-auto sm:pl-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * A run or generation log. It follows new lines while the reader is at its
 * end, and scrolls only itself: the scrollIntoView it replaces also moved
 * the page around it.
 */
function LogBox({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <pre
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="scroll-thin max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-term-bg p-3 font-mono text-xs leading-5 text-term-text"
    >
      {lines.map((log, i) => {
        const lower = log.toLowerCase();
        const isErr = lower.includes("error") || lower.includes("fail") || lower.includes("✗");
        const isOk = lower.includes("success") || lower.includes("✓") || lower.includes(" ok");
        return (
          <div key={i} className={isErr ? "text-term-err" : isOk ? "text-term-ok" : "text-term-muted"}>
            {log}
          </div>
        );
      })}
    </pre>
  );
}

/** A file-type icon from the file's extension. */
function fileIconFor(name: string): IconName {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["csv", "xlsx", "xls", "ods"].includes(ext)) return "fileSpreadsheet";
  if (["json", "yaml", "yml", "py"].includes(ext)) return "fileBraces";
  if (["mp3", "wav", "m4a", "ogg", "flac"].includes(ext)) return "fileHeadphone";
  if (["png", "jpg", "jpeg", "gif", "webp", "tif", "tiff"].includes(ext)) return "fileImage";
  if (["pdf", "md", "txt", "doc", "docx", "rtf"].includes(ext)) return "fileText";
  return "file";
}

/** "1:05" for a run that has gone on for 65 s. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function WorkflowFlowTab({
  sessionId,
  sessionTitle,
  wizardStep,
  blueprint,
  bpmnRefreshKey,
  onBlueprintChange,
  pocNoteLabel,
  onSaved,
  t,
  typeLabel,
}: {
  sessionId: string;
  sessionTitle: string;
  wizardStep: number;
  blueprint: Blueprint;
  bpmnRefreshKey: number;
  onBlueprintChange: (blueprint: Blueprint) => void;
  pocNoteLabel: string | null;
  onSaved: (via: "save" | "undo") => void;
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
          propertiesTitle={t.wsBpmnPropertiesTitle}
          propertiesName={t.wsBpmnPropertiesName}
          propertiesType={t.wsBpmnPropertiesType}
          propertiesCloseLabel={t.wsBpmnPropertiesClose}
          typeNames={t.wsBpmnTypeNames}
          pocNoteLabel={pocNoteLabel}
          onLocalStepNameChange={(stepId, nextName) => {
            onBlueprintChange({
              ...blueprint,
              steps: blueprint.steps.map((s) =>
                s.id === stepId ? { ...s, name: nextName } : s,
              ),
            });
          }}
          onSynced={({ blueprint: synced, xml, via }) => {
            onBlueprintChange(synced);
            setBpmnXml(xml);
            onSaved(via);
          }}
        />
      )}

      <details className="shrink-0 rounded-lg border border-border bg-surface-muted/40 px-3 py-2">
        <summary className="text-sm font-medium text-text-secondary cursor-pointer">
          {t.wsStepList}
        </summary>
        <div className="mt-3 max-h-48 overflow-auto">
          <StepListFlow blueprint={blueprint} t={t} typeLabel={typeLabel} />
        </div>
      </details>

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
const TAB_ICONS: Record<Tab, IconName> = {
  flow: "workflow",
  json: "braces",
  plan: "listChecks",
  poc: "flaskConical",
};

export function WorkspacePanel({
  sessionId,
  sessionTitle,
  wizardStep,
  blueprint: initialBlueprint,
  hasSuccessfulRun = false,
  latestRun = null,
  initialTab,
  t,
}: {
  sessionId: string;
  sessionTitle: string;
  wizardStep: number;
  blueprint: Blueprint;
  /** wizard_api has recorded a successful sandbox run (#143); opens the deployable download. */
  hasSuccessfulRun?: boolean;
  /** The session's latest sandbox run; shown again when the page is reloaded. */
  latestRun?: string | null;
  /** The tab to open on, e.g. "poc" when coming back from the case view. */
  initialTab?: Tab;
  t: Dict;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "flow");
  const [blueprint, setBlueprint] = useState(initialBlueprint);
  // The page re-renders with the session's active blueprint after every chat
  // turn (router.refresh()); take it when its content changed, or the Plan
  // and Blueprint tabs keep the version the page first rendered with.
  const propBlueprintKeyRef = useRef(blueprintKey(initialBlueprint));
  useEffect(() => {
    const key = blueprintKey(initialBlueprint);
    if (key === propBlueprintKeyRef.current) return;
    propBlueprintKeyRef.current = key;
    setBlueprint(initialBlueprint);
  }, [initialBlueprint]);
  const [bpmnRefreshKey, setBpmnRefreshKey] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [pocStatus, setPocStatus] = useState<PocStatus>("idle");
  // Files the agent's PoC scaffolder produced (null = not yet loaded).
  const [pocGenerated, setPocGenerated] = useState(false);
  // False until the api has answered once: before that the tab does not know
  // whether a package exists, and said "not generated yet" for one that did.
  const [pocLoaded, setPocLoaded] = useState(false);
  // Blueprint saves made here that the PoC package does not have yet: an undo
  // of the only save takes the note away again, and a new package resets it.
  const [unpackagedChanges, setUnpackagedChanges] = useState(0);
  // Whether a package exists, asked for after a save while the PoC tab has not
  // said: the note is about a package, so with none it is not shown.
  const [pocExistsAfterSave, setPocExistsAfterSave] = useState<boolean | null>(null);
  const pocExists = pocLoaded ? pocGenerated : pocExistsAfterSave === true;
  const pocNote = unpackagedChanges > 0 && pocExists ? t.wsSavedPocNote : null;
  function noteBlueprintSaved(via: "save" | "undo") {
    setUnpackagedChanges((n) => (via === "undo" && n > 0 ? n - 1 : n + 1));
    if (pocLoaded || pocExistsAfterSave !== null) return;
    fetch(`/api/sessions/${sessionId}/poc/files`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : NO_POC_PACKAGE))
      .then((d: unknown) => setPocExistsAfterSave(pocPackageState(d).generated))
      .catch(() => setPocExistsAfterSave(null));
  }
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [runMessage, setRunMessage] = useState<string | null>(null);
  // True once the Job exists: an error after that is "following the run was
  // interrupted", not "the run could not be started".
  const [runStarted, setRunStarted] = useState(false);
  const [runLogs, setRunLogs] = useState<string[]>([]);
  // What the last run wrote to output/, read by the api from the log once the
  // run has succeeded; null until then. Shown as the result, above the log.
  const [runOutput, setRunOutput] = useState<PocRunOutput | null>(null);
  /** The run the tab follows now; an earlier run's output arriving late is dropped. */
  const activeRunRef = useRef<string | null>(null);
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
  // The last package state read from the api: an unchanged answer (most polls)
  // sets nothing, so the panel does not re-render for it.
  const packageRef = useRef<PocPackageState | null>(null);
  // The page is visible: a background tab does not keep asking for the package.
  const [pageVisible, setPageVisible] = useState(true);
  // The preflight (#252): one sandbox check per package version, run by itself.
  const [pocVersion, setPocVersion] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PreflightState>(NO_PREFLIGHT);
  // A check counts only for the package version it looked at, so the result
  // of an earlier version does not describe a rewritten package.
  const checkPhase = preflight.version !== null && preflight.version === pocVersion ? preflight.phase : "idle";
  // A package whose files are complete can still fail the check; it is then not
  // "ready to run", and the run is no longer the step the tab points to.
  const checkFailed = checkPhase === "failed";
  // Step 1's one status line: ready to run only once the check passed.
  const packageState = packageStatus({
    loaded: pocLoaded,
    generated: pocGenerated,
    complete: pocReady,
    preflight: checkPhase,
  });
  const checkedVersionRef = useRef<string | null>(null);
  // A preflight the sandbox had no room for is asked for again after Retry-After;
  // bumping this re-runs the preflight effect once the version is unmarked.
  const [preflightRetry, setPreflightRetry] = useState(0);
  const preflightRetryTimer = useRef<number | null>(null);
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
  // simulated run, when a sandbox run ends, and on the poll below, so a package
  // the agent finishes while the tab is open appears without a reload.
  useEffect(() => {
    if (tab !== "poc") return;
    let cancelled = false;
    fetch(`/api/sessions/${sessionId}/poc/files`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : NO_POC_PACKAGE))
      .then((d: unknown) => {
        if (cancelled) return;
        setPocLoaded(true);
        const state = pocPackageState(d);
        if (packageRef.current && samePocPackage(packageRef.current, state)) return;
        packageRef.current = state;
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
          setPocLoaded(true);
          packageRef.current = null;
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

  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  // The agent writes the package during its turns and nothing tells this panel,
  // so an open PoC tab asks the api again by itself: often while the package is
  // being written, now and then once it is ready (a rewrite is a new version,
  // which starts a new preflight). See lib/poc-package-poll.ts.
  const runActive = runPhase === "pending" || runPhase === "running";
  // When the run in this view started, for the elapsed time beside it; a
  // run followed after a reload has none and shows its phase instead.
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!runActive) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [runActive]);
  useEffect(() => {
    const delay = pocPollDelay({
      onPocTab: tab === "poc",
      visible: pageVisible,
      ready: pocGenerated && pocReady,
      runActive,
    });
    if (delay === null) return;
    const timer = window.setTimeout(() => setPocRefresh((n) => n + 1), delay);
    return () => window.clearTimeout(timer);
  }, [tab, pageVisible, pocGenerated, pocReady, runActive, pocRefresh]);

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
        // about the package, so they show nothing. A 429 (sandbox busy) is asked
        // again after Retry-After: the version is unmarked so the effect runs again.
        if (!started.ok || typeof body.run_id !== "string") {
          if (checkedVersionRef.current === version) setPreflight(NO_PREFLIGHT);
          const delay = preflightRetryDelayMs(started.status, started.headers.get("Retry-After"));
          if (delay !== null) {
            if (preflightRetryTimer.current !== null) window.clearTimeout(preflightRetryTimer.current);
            preflightRetryTimer.current = window.setTimeout(() => {
              preflightRetryTimer.current = null;
              if (checkedVersionRef.current !== version) return;
              checkedVersionRef.current = null;
              setPreflightRetry((n) => n + 1);
            }, delay);
          }
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
  }, [tab, sessionId, pocGenerated, pocReady, pocVersion, preflightRetry]);

  useEffect(
    () => () => {
      if (preflightRetryTimer.current !== null) window.clearTimeout(preflightRetryTimer.current);
    },
    [],
  );

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

  /** The run's output files, as the api read them from the log. A failure to
   * read them leaves the log as the only account of the run. */
  async function loadRunOutput(runId: string) {
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/runs/${encodeURIComponent(runId)}/output`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const body = await res.json();
      // The button re-enables on the done frame, before this fetch resolves: a
      // run started meanwhile must not show the previous run's result.
      if (activeRunRef.current !== runId) return;
      setRunOutput(pocRunOutput(body));
    } catch {
      // The log stays; nothing else to say.
    }
  }

  /** Start a sandbox run and follow it (#94). Nothing here simulates: a run
   * that did not happen cannot report that it did. */
  async function runInSandbox() {
    setRunStartedAt(Date.now());
    setClock(Date.now());
    setRunPhase("pending");
    setRunMessage(null);
    setRunStarted(false);
    setRunLogs([]);
    setRunOutput(null);
    activeRunRef.current = null;

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
        // 429: the run limits of the shared project quota, not a problem with the package.
        setRunMessage(
          body?.detail?.error === "sandbox_busy"
            ? t.pocRunBusy
            : (body?.detail?.message ?? body?.message ?? t.pocRunError),
        );
        return;
      }
      runId = body.run_id;
      activeRunRef.current = runId;
      started = true;
      setRunStarted(true);
    } catch {
      setRunPhase("error");
      setRunMessage(t.pocRunError);
      return;
    }

    setRunPhase("running");
    await followRun(runId, started);
  }

  /** Follow a run's log stream to its end: from the start, or after a reload. */
  async function followRun(runId: string, started: boolean) {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/runs/${runId}/stream`);
      if (!res.ok || !res.body) throw new Error("stream failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      // The base64 files block is for downloads, read by the api; not shown.
      const showLine = runLogLineFilter();
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
          if (typeof evt.log === "string" && showLine(evt.log)) {
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
            setRunMessage(runEndMessage(evt));
            // Not trusted for the deployable download: the api records the run
            // on this frame, but a concurrent metadata write may lose the record
            // (#253). Re-read the package state and let the api say.
            setPocRefresh((n) => n + 1);
            if (evt.phase === "succeeded") void loadRunOutput(runId);
          }
        }
      }
    } catch {
      setRunPhase("error");
      setRunMessage(started ? t.pocRunInterrupted : t.pocRunError);
    }
  }

  // After a reload the tab knew nothing of the last run and said the PoC had
  // never been run, while its result and downloads were still on the server.
  // Ask the api where the session's latest run got to and show it again; one
  // still going is followed to its end. Once per run id.
  const restoredRunRef = useRef<string | null>(null);
  useEffect(() => {
    if (!latestRun || restoredRunRef.current === latestRun) return;
    if (activeRunRef.current) return;
    restoredRunRef.current = latestRun;
    const runId = latestRun;
    void (async () => {
      try {
        const res = await fetch(
          `/api/sessions/${sessionId}/runs/${encodeURIComponent(runId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const run = restoredRun(await res.json());
        // A run started in this view meanwhile has the tab now.
        if (!run || activeRunRef.current) return;
        activeRunRef.current = runId;
        setRunStarted(true);
        setRunPhase(run.phase);
        setRunMessage(run.message);
        if (!run.finished) {
          await followRun(runId, true);
        } else if (run.phase === "succeeded") {
          await loadRunOutput(runId);
        }
      } catch {
        // Nothing to show; the tab stays as a fresh one.
      }
    })();
    // followRun and loadRunOutput read only refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRun, sessionId]);

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

  const RUN_PHASE_LABEL: Record<RunPhase, string> = {
    idle: "",
    pending: t.pocPhasePending,
    running: t.pocPhaseRunning,
    succeeded: t.pocPhaseSucceeded,
    failed: t.pocPhaseFailed,
    timeout: t.pocPhaseTimeout,
    error: runStarted ? t.pocRunInterrupted : t.pocRunError,
  };

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
    setRunOutput(null);
    setRunStartedAt(null);
    activeRunRef.current = null;
    // The saves a rebuilt package will have: those made before it started.
    const includedChanges = unpackagedChanges;
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
          if (evt.done) {
            const generated = evt.status === "success";
            setPocStatus(generated ? "success" : "failed");
            // A rebuilt package has the changes saved before it started; a
            // package the agent wrote is kept as it was, so the note stays.
            if (generated && evt.scaffolded !== false) {
              setUnpackagedChanges((n) => Math.max(0, n - includedChanges));
            }
          }
        }
      }
    } catch {
      setPocStatus("failed");
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="mb-4 shrink-0">
        <div
          role="tablist"
          aria-label={t.workspace}
          className="scroll-thin flex items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border"
        >
          {TABS.map((key) => {
            const tabId = `${baseId}-tab-${key}`;
            const panelId = `${baseId}-panel-${key}`;
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={tabId}
                aria-selected={active}
                aria-controls={panelId}
                title={t.wsTabHints[key]}
                onClick={() => setTab(key)}
                className={`focus-inset -mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "border-brand text-brand-text"
                    : "border-transparent text-text-muted hover:border-border-strong hover:text-text"
                }`}
              >
                <Icon name={TAB_ICONS[key]} size={16} />
                {tabLabels[key]}
              </button>
            );
          })}
        </div>
        {/* What the open tab is for: three of the four show the same solution
            in different forms, and their names alone did not say so. */}
        <p className="mt-2 text-xs text-text-muted">{t.wsTabHints[tab]}</p>
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
            className="relative flex-1 min-h-0 overflow-y-auto"
          >
            {key === "flow" && tab === "flow" && (
              <WorkflowFlowTab
                  sessionId={sessionId}
                  sessionTitle={sessionTitle}
                  wizardStep={wizardStep}
                  blueprint={blueprint}
                  bpmnRefreshKey={bpmnRefreshKey}
                  onBlueprintChange={setBlueprint}
                  pocNoteLabel={pocNote}
                  onSaved={noteBlueprintSaved}
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
                  noteBlueprintSaved("save");
                }}
                pocNoteLabel={pocNote}
                t={t}
              />
            )}

            {key === "plan" && <SolutionPlanView blueprint={blueprint} t={t} />}

            {key === "poc" && (
              <div className="flex max-w-4xl flex-col gap-3 pb-2">
                {/* 1 · The package the wizard generates from the blueprint. */}
                <StepCard
                  n={1}
                  title={t.pocStepPackage}
                  // The same state the line beside it shows: not done while the
                  // check runs, when it failed, or when none could run.
                  done={packageState === "ready"}
                  status={
                    <span
                      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"
                      data-testid="poc-package-status"
                      data-state={packageState}
                    >
                      {/* One line for the files and the preflight together: the
                          package is ready to run only once the check passed. */}
                      {packageState === "loading" ? (
                        <span>{t.pocLoading}</span>
                      ) : packageState === "missing" ? (
                        <span data-testid="poc-run-hint">{t.pocRunHint}</span>
                      ) : packageState === "incomplete" ? (
                        <span className="text-danger-text">{t.pocNotReadyTitle}</span>
                      ) : packageState === "unchecked" ? (
                        <span>{t.pocGeneratedTitle}</span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 ${
                            packageState === "failed"
                              ? "text-danger-text"
                              : packageState === "ready"
                                ? "text-success-text"
                                : ""
                          }`}
                          data-testid="poc-check"
                          data-phase={checkPhase}
                        >
                          <Icon
                            name={
                              packageState === "checking"
                                ? "loaderCircle"
                                : packageState === "ready"
                                  ? "circleCheck"
                                  : "circleAlert"
                            }
                            size={13}
                            className={packageState === "checking" ? "animate-spin" : ""}
                          />
                          {packageState === "checking"
                            ? t.pocCheckRunning
                            : packageState === "ready"
                              ? t.pocPackageReady
                              : t.pocPackageHasErrors}
                        </span>
                      )}
                      {pocStatus === "success" && (
                        <span className="badge-success">
                          <Icon name="check" size={12} />
                          {t.pocSuccess}
                        </span>
                      )}
                      {pocStatus === "failed" && (
                        <span className="badge border-danger-border bg-danger-bg text-danger-text">
                          {t.pocFailed}
                        </span>
                      )}
                    </span>
                  }
                  actions={
                    <>
                      {/* An incomplete package downloads and does nothing; the
                          api says so (ready: false), so the link is withheld. */}
                      {pocReady && (
                        <a
                          href={`/api/sessions/${sessionId}/poc/download`}
                          download
                          title={t.pocDownloadHint}
                          className="btn-secondary"
                        >
                          <Icon name="download" size={16} />
                          {t.pocDownload}
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={runPoc}
                        disabled={pocStatus === "running" || runActive}
                        className={pocGenerated ? "btn-ghost" : "btn-brand"}
                      >
                        <Icon
                          name={
                            pocStatus === "running"
                              ? "loaderCircle"
                              : pocGenerated || logs.length > 0
                                ? "rotateCcw"
                                : "package"
                          }
                          size={16}
                          className={pocStatus === "running" ? "animate-spin" : ""}
                        />
                        {pocStatus === "running"
                          ? t.pocRunning
                          : pocGenerated || logs.length > 0
                            ? t.pocRerun
                            : t.pocRun}
                      </button>
                    </>
                  }
                >
                  {!pocReady && pocProblems.length > 0 && (
                    <ul
                      className="list-disc border-t border-border py-2.5 pl-9 pr-4 text-xs text-danger-text"
                      data-testid="poc-problems"
                    >
                      {pocProblems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )}
                  {checkFailed && preflight.problems.length > 0 && (
                    <div className="border-t border-border px-4 py-2.5 text-xs text-danger-text">
                      <p className="font-medium">{t.pocCheckFailed}</p>
                      <ul className="mt-1 list-disc pl-5">
                        {preflight.problems.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {pocFiles.length > 0 && (
                    <details className="border-t border-border px-4 py-2.5">
                      <summary className="cursor-pointer text-xs font-medium text-text-secondary">
                        {t.pocFilesToggle.replace("{n}", String(pocFiles.length))}
                      </summary>
                      <ul className="mt-2 gap-x-6 font-mono text-xs text-text-muted sm:columns-2">
                        {pocFiles.map((f) => (
                          <li key={f} className="truncate" title={f}>
                            {f}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {/* What generation printed, while it runs and after. */}
                  {logs.length > 0 && runPhase === "idle" && (
                    <div className="border-t border-border p-3">
                      <LogBox lines={logs} />
                    </div>
                  )}
                </StepCard>

                {/* 2 · Sample input (#95): what the run reads. Without a file
                    here a document PoC fails at "No PDF files found". */}
                <StepCard
                  n={2}
                  title={t.pocInputsTitle}
                  done={pocGenerated && pocInputs.length > 0}
                  muted={!pocGenerated}
                  testId="poc-inputs"
                  status={
                    pocGenerated ? (
                      <span data-testid="poc-input-reminder">{t.pocInputReminder}</span>
                    ) : (
                      t.pocNeedsPackage
                    )
                  }
                  actions={
                    pocGenerated && (
                      <label
                        className={`btn-secondary ${inputBusy ? "opacity-60" : "cursor-pointer"}`}
                      >
                        <Icon
                          name={inputBusy ? "loaderCircle" : "upload"}
                          size={16}
                          className={inputBusy ? "animate-spin" : ""}
                        />
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
                    )
                  }
                >
                  {pocGenerated &&
                    (pocInputs.length === 0 ? (
                      <p className="border-t border-border px-4 py-2.5 text-xs text-text-muted">
                        {t.pocInputsEmpty}
                      </p>
                    ) : (
                      <ul className="divide-y divide-border border-t border-border">
                        {pocInputs.map((f) => (
                          <li key={f.name} className="flex items-center gap-3 py-1.5 pl-4 pr-2">
                            <Icon name={fileIconFor(f.name)} size={16} className="text-text-muted" />
                            <span
                              className="min-w-0 flex-1 truncate text-sm text-text"
                              title={`sample_input/${f.name}`}
                            >
                              {f.name}
                            </span>
                            <span className="shrink-0 text-xs text-text-muted">{formatSize(f.bytes)}</span>
                            <button
                              type="button"
                              className="icon-btn hover:text-danger-text"
                              disabled={inputBusy}
                              onClick={() => void removeInput(f.name)}
                              aria-label={`${t.pocInputRemove} ${f.name}`}
                              title={t.pocInputRemove}
                            >
                              <Icon name="trash2" size={15} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ))}
                  {inputError && (
                    <p className="border-t border-border px-4 py-2 text-xs text-danger-text" role="alert">
                      {inputError}
                    </p>
                  )}
                </StepCard>

                {/* 3 · The real run (#94), beside generation. Enabled only once
                    a package exists — a run with nothing to run is the state
                    the old simulated button reported as success. */}
                <StepCard
                  n={3}
                  title={t.pocStepRun}
                  done={runPhase === "succeeded"}
                  muted={!pocGenerated}
                  status={
                    runPhase === "idle" ? (
                      pocGenerated ? (
                        t.pocIdle
                      ) : (
                        t.pocNeedsPackage
                      )
                    ) : (
                      <span
                        data-testid="poc-run-phase"
                        className={`inline-flex items-center gap-1.5 ${
                          runPhase === "succeeded"
                            ? "text-success-text"
                            : runActive
                              ? "text-text-secondary"
                              : "text-danger-text"
                        }`}
                      >
                        <Icon
                          name={
                            runActive ? "loaderCircle" : runPhase === "succeeded" ? "circleCheck" : "circleAlert"
                          }
                          size={13}
                          className={runActive ? "animate-spin" : ""}
                        />
                        {runActive
                          ? runStartedAt
                            ? t.pocRunElapsed.replace("{time}", formatElapsed(clock - runStartedAt))
                            : RUN_PHASE_LABEL[runPhase]
                          : RUN_PHASE_LABEL[runPhase]}
                      </span>
                    )
                  }
                  actions={
                    <button
                      type="button"
                      onClick={runInSandbox}
                      disabled={!pocGenerated || !pocReady || runActive}
                      title={!pocGenerated || !pocReady ? t.pocRunSandboxHint : undefined}
                      className={
                        pocGenerated && pocReady && !checkFailed && runPhase !== "succeeded"
                          ? "btn-brand"
                          : "btn-secondary"
                      }
                      data-testid="poc-run-sandbox"
                    >
                      <Icon
                        name={runActive ? "loaderCircle" : runPhase === "idle" ? "play" : "rotateCcw"}
                        size={16}
                        className={runActive ? "animate-spin" : ""}
                      />
                      {runActive ? t.pocRunning2 : runPhase === "idle" ? t.pocRunSandbox : t.pocRunAgain}
                    </button>
                  }
                >
                  {/* Why the run ended the way it did: the reason the api read
                      from the log's last lines (the exception under the
                      traceback), or the Job's words when the log says nothing. */}
                  {(runPhase === "error" || runPhase === "failed" || runPhase === "timeout") && (
                    <div
                      className="border-t border-border px-4 py-2.5"
                      role="alert"
                      data-testid="poc-run-message"
                    >
                      <p className="break-words rounded-md border border-danger-border bg-danger-bg px-3 py-2 font-mono text-xs text-danger-text">
                        {runMessage || RUN_PHASE_LABEL[runPhase]}
                      </p>
                    </div>
                  )}

                  {runOutput && (
                    <section
                      className="flex flex-col gap-2 border-t border-border px-4 py-3"
                      data-testid="poc-run-output"
                      aria-label={t.pocResultTitle}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-text">{t.pocResultTitle}</h4>
                        {runOutput.validation && (
                          <span
                            className={runOutput.validation.passed ? "badge-success" : "badge-warning"}
                            data-testid="poc-run-grounding"
                          >
                            {runOutput.validation.passed ? t.pocResultChecksOk : t.pocResultChecksBad}
                          </span>
                        )}
                      </div>
                      {!hasRunOutput(runOutput) && (
                        <p className="text-xs text-text-muted">{t.pocResultNone}</p>
                      )}
                      {runOutput.runId && (runOutput.downloads.length > 0 || runOutput.skipped.length > 0) && (
                        <div className="flex flex-col gap-1" data-testid="poc-run-downloads">
                          <span className="text-xs font-medium text-text-muted">{t.pocResultDownloads}</span>
                          <ul className="flex flex-wrap gap-2">
                            {runOutput.downloads.map((f) => (
                              <li key={f.name}>
                                <a
                                  href={runFileHref(sessionId, runOutput.runId as string, f.name)}
                                  download={f.name}
                                  className="btn-secondary py-1.5 text-xs"
                                >
                                  <Icon name={fileIconFor(f.name)} size={14} />
                                  <span className="font-mono">{f.name}</span>
                                  <span className="text-text-muted">{formatSize(f.size)}</span>
                                </a>
                              </li>
                            ))}
                          </ul>
                          {runOutput.skipped.map((f) => (
                            <p key={f.name} className="text-xs text-text-muted">
                              {t.pocResultSkipped.replace("{name}", f.name).replace("{size}", formatSize(f.size))}
                            </p>
                          ))}
                        </div>
                      )}
                      {(Array.isArray(runOutput.record) ? runOutput.record : runOutput.record ? [runOutput.record] : []).map(
                        (record, i, all) => {
                          const sections = documentSections(record);
                          return (
                            <div key={i} className="flex flex-col gap-1" data-testid="poc-run-record">
                              {all.length > 1 && (
                                <span className="text-xs font-medium text-text-muted">
                                  {t.pocResultRecord} {i + 1}
                                </span>
                              )}
                              {sections ? (
                                sections.map((sec, j) => (
                                  <div key={j}>
                                    <h5 className="text-sm font-semibold text-text">{sec.title}</h5>
                                    <p className="whitespace-pre-wrap text-sm text-text">{sec.text}</p>
                                  </div>
                                ))
                              ) : (
                                <table className="w-full text-sm">
                                  <tbody>
                                    {recordRows(record).map((row) => (
                                      <tr key={row.field} className="border-t border-border align-top">
                                        <th
                                          scope="row"
                                          className="whitespace-nowrap py-1 pr-3 text-left font-medium text-text-muted"
                                        >
                                          {row.label}
                                        </th>
                                        <td className="whitespace-pre-wrap break-words py-1 text-text">{row.value}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          );
                        },
                      )}
                      {runOutput.document && (
                        <details open>
                          <summary className="cursor-pointer text-sm font-semibold text-text">
                            {t.pocResultDocument}
                          </summary>
                          <p className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-app p-3 text-sm text-text">
                            {runOutput.document}
                          </p>
                        </details>
                      )}
                      {runOutput.transcript && (
                        <details>
                          <summary className="cursor-pointer text-sm font-semibold text-text">
                            {t.pocResultTranscript}
                          </summary>
                          <p className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-app p-3 text-sm text-text">
                            {runOutput.transcript}
                          </p>
                        </details>
                      )}
                      {runOutput.files.length > 0 && (
                        <details>
                          <summary className="cursor-pointer text-sm font-semibold text-text">
                            {t.pocResultFiles} ({runOutput.files.length})
                          </summary>
                          <ul className="mt-1 flex flex-col gap-1">
                            {runOutput.files.map((f) => (
                              <li key={f.name}>
                                <details>
                                  <summary className="cursor-pointer font-mono text-xs text-text">{f.name}</summary>
                                  <pre className="scroll-thin mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-app p-2 font-mono text-xs text-text">
                                    {f.body}
                                  </pre>
                                </details>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </section>
                  )}

                  {/* Gate 3 is a loop (#96): the agent reads this run's log and
                      output with the next chat message, so the way to change
                      the PoC is to say what is wrong there and run it again. */}
                  {!runActive && runPhase !== "idle" && (
                    <p
                      className="border-t border-border px-4 py-2.5 text-xs text-text-muted"
                      data-testid="poc-refine-hint"
                    >
                      {t.pocRefineHint}
                    </p>
                  )}

                  {/* The log: live while the run goes, folded once it is over.
                      Nothing is drawn before the first line arrives. */}
                  {runPhase !== "idle" && runLogs.length > 0 && (
                    <details
                      className="border-t border-border px-4 py-2.5"
                      data-testid="poc-run-log"
                      open={runActive || runPhase === "error" || runPhase === "failed" || runPhase === "timeout"}
                    >
                      <summary className="cursor-pointer text-xs font-medium text-text-secondary">
                        {t.pocResultLog} · {t.pocLogLines.replace("{n}", String(runLogs.length))}
                      </summary>
                      <div className="mt-2">
                        <LogBox lines={runLogs} />
                      </div>
                    </details>
                  )}
                </StepCard>

                {/* 4 · The hand-over (#143): wizard_api serves the deployable
                    zip only after a run it recorded as successful. */}
                <StepCard
                  n={4}
                  title={t.pocStepUse}
                  done={pocReady && runRecorded}
                  muted={!pocReady}
                  status={!pocReady ? t.pocNeedsPackage : runRecorded ? t.pocUseReady : t.pocDeployableHint}
                >
                  {pocReady && (
                    <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
                      <a
                        href={`/sessions/${sessionId}/cases`}
                        className="btn-secondary"
                        title={t.pocOpenCasesHint}
                        data-testid="poc-open-cases"
                      >
                        <Icon name="users" size={16} />
                        {t.pocOpenCases}
                      </a>
                      {runRecorded ? (
                        <a
                          href={`/api/sessions/${sessionId}/poc/deployable`}
                          download
                          className="btn-secondary"
                          data-testid="poc-deployable"
                        >
                          <Icon name="download" size={16} />
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
                          <Icon name="lock" size={16} />
                          {t.pocDeployable}
                        </button>
                      )}
                    </div>
                  )}
                </StepCard>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
