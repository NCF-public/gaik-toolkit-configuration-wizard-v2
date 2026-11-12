"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Blueprint, BlueprintStepType } from "@/lib/mock-sessions";
import {
  nextTabForStepChange,
  tabForStep,
  visibleTabs,
  type WorkspaceTab,
} from "@/lib/workspace-tab-follow";
import { POC_STEP } from "@/lib/mock-sessions";
import { blueprintKey } from "@/lib/blueprint-sync";
import { NO_POC_PACKAGE, pocPackageState, samePocPackage } from "@/lib/poc-package-state";
import type { PocPackageState } from "@/lib/poc-package-state";
import { pocPollDelay } from "@/lib/poc-package-poll";
import { runLogLineFilter } from "@/lib/poc-run-log";
import {
  NO_PREFLIGHT,
  packageStatus,
  preflightIsFinding,
  preflightOutcome,
  readStoredPreflight,
  shouldStartPreflight,
  unfinishedPreflight,
  writeStoredPreflight,
  type PreflightState,
  type PreflightStore,
} from "@/lib/poc-preflight";
import { isSandboxBusy, preflightRetryDelayMs, retryAfterMs } from "@/lib/sandbox-busy";
import { autoRunDecision, userInputs, type PocInputFile } from "@/lib/poc-auto-run";
import { sourceTraceIn, sourcesForField } from "@/lib/poc-source-trace";
import { CHAT_REPLYING_EVENT } from "@/lib/chat-events";
import { FieldSources } from "@/components/poc-field-sources";
import type { Dict } from "@/lib/i18n";
import {
  documentSections,
  formatSize,
  hasRunOutput,
  outputFileEntries,
  pocRunOutput,
  recordTable,
  runFileHref,
  type NestedTable,
  recordRows,
  restoredRun,
  runEndMessage,
  type PocRunOutput,
  type RunRecord,
  type ValueWords,
} from "@/lib/poc-run-output";
import { shouldShowBpmnSpike } from "@/lib/bpmn-spike";
import { BlueprintJsonEditor } from "@/components/blueprint-json-editor";
import { BlueprintModeBar } from "@/components/blueprint-mode-bar";
import { SolutionPlanView } from "@/components/solution-plan-view";
import { AskStepButton, StepNumber, StepTypeTag, stepTypeLabels } from "@/components/step-type";
import { Icon, fileIconFor, type IconName } from "@/components/icons";

const BpmnDiagramPanel = dynamic(
  () =>
    import("@/components/bpmn-diagram-panel").then((m) => ({
      default: m.BpmnDiagramPanel,
    })),
  { ssr: false },
);

const WorkflowFlowView = dynamic(
  () =>
    import("@/components/workflow-flow-view").then((m) => ({
      default: m.WorkflowFlowView,
    })),
  { ssr: false },
);

/**
 * The solution's process steps in order, one compact row each: the number in
 * the step type's colour, the name, the type and one line of description.
 * With `onSelectStep` a row picks its task on the diagram.
 */
function StepListFlow({
  blueprint,
  t,
  typeLabel,
  selectedStepId = null,
  onSelectStep,
}: {
  blueprint: Blueprint;
  t: Dict;
  typeLabel: Record<BlueprintStepType, string>;
  selectedStepId?: string | null;
  onSelectStep?: (stepId: string) => void;
}) {
  return (
    <ol className="flex flex-col gap-0.5" data-testid="flow-step-list">
      {blueprint.steps.map((s, i) => {
        const selected = s.id === selectedStepId;
        const body = (
          <>
            <StepNumber n={i + 1} type={s.type} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-text">{s.name}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
                <StepTypeTag type={s.type} label={typeLabel[s.type]} />
                {s.description && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{s.description}</span>
                  </>
                )}
              </span>
            </span>
          </>
        );
        return (
          <li
            key={s.id}
            className={`flex items-center gap-1 rounded-lg transition-colors duration-150 ${
              selected ? "bg-brand-soft" : onSelectStep ? "hover:bg-surface-muted/70" : ""
            }`}
            data-testid={`flow-step-${i}`}
            data-selected={selected || undefined}
          >
            {onSelectStep ? (
              <button
                type="button"
                className="focus-inset flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left"
                aria-pressed={selected}
                onClick={() => onSelectStep(s.id)}
              >
                {body}
              </button>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2">{body}</div>
            )}
            <AskStepButton step={s} index={i} t={t} className="mr-1" testId={`flow-step-${i}-ask`} />
          </li>
        );
      })}
    </ol>
  );
}

function StepListHeading({ t, count }: { t: Dict; count: number }) {
  return (
    <h3 className="mb-1.5 px-2 text-sm font-semibold text-text-strong">
      {t.wsStepList} <span className="font-normal text-text-muted">({count})</span>
    </h3>
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
    // A container: in the PoC's narrow left column the actions go under the
    // title, in a wide card they sit beside it.
    <section
      className={`@container rounded-lg border border-border bg-surface ${muted ? "opacity-70" : ""}`}
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
        {actions && (
          <div className="flex w-full flex-wrap items-center gap-2 pl-9 @md:w-auto @md:pl-0">{actions}</div>
        )}
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


/** A list field of the result (an order's lines) as a table, where the tab showed its JSON. */
function NestedTableView({ table }: { table: NestedTable }) {
  return (
    <div className="scroll-thin w-full overflow-x-auto rounded-md border border-border [contain:inline-size]" data-testid="poc-run-nested-table">
      <table className="w-full whitespace-normal text-xs">
        <thead className="bg-surface-muted">
          <tr>
            {table.columns.map((c) => (
              <th key={c.field} scope="col" className="whitespace-nowrap px-2 py-1 text-left font-medium text-text-secondary">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((cells, i) => (
            <tr key={i} className="border-t border-border align-top">
              {cells.map((cell, j) => (
                <td key={j} className="px-2 py-1 text-text">
                  {cell || "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "1:05" for a run that has gone on for 65 s. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The width the Workflow tab needs for the steps and the diagram side by
 * side. It is the tab's own width, not the window's: the chat dock takes its
 * share of a 1280-1440 px window when it is open, and the diagram then gets
 * the whole tab instead of a narrow strip beside the list. With the chat
 * closed, a 1280 px window is wide enough.
 */
const FLOW_TWO_COLUMNS_MIN_WIDTH = 900;

/** Whether the element given to `ref` is at least `minWidth` wide (false until it is measured). */
function useWideEnough(minWidth: number): [(el: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (!el) return;
    const update = () => setWide(el.getBoundingClientRect().width >= minWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, minWidth]);
  return [setEl, wide];
}

/**
 * The diagram each session's Workflow tab last showed, kept while the page is
 * open: the tab unmounts when another tab opens, and should come back as it
 * was left, also with the BPMN editor's unsaved edits on screen.
 */
const lastNotation = new Map<string, "flow" | "bpmn">();

/**
 * The Työnkulku tab: the process steps and the diagram. The diagram is the
 * simple flow drawn from the blueprint; "Avaa BPMN-kaaviona" shows the same
 * process in the BPMN editor instead. With room for both (a 1280 px window
 * with the chat closed) the steps are a column beside the diagram, under the
 * switch between the two diagrams; narrower, the switch is a row above and
 * "Lista" takes the diagram's place. The diagram fills the height the tab
 * has, so "fit" fits what the user sees.
 */
function WorkflowFlowTab({
  sessionId,
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
  const [retry, setRetry] = useState(0);
  const [rootRef, wide] = useWideEnough(FLOW_TWO_COLUMNS_MIN_WIDTH);
  const [view, setView] = useState<"diagram" | "list">("diagram");
  // Which diagram: the simple flow, or the BPMN editor.
  const [notation, setNotation] = useState<"flow" | "bpmn">(() => lastNotation.get(sessionId) ?? "flow");
  // After Gate 2 the flow opens read-only, as the Blueprint tab does; "Muokkaa" opens it for this visit.
  const [flowUnlocked, setFlowUnlocked] = useState(false);
  const [diagramShown, setDiagramShown] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ stepId: string; seq: number } | null>(null);

  // The BPMN editor loads once it is first on screen, and stays for the selection and unsaved edits.
  const diagramVisible = wide || view === "diagram";
  useEffect(() => {
    if (diagramVisible) setDiagramShown(true);
  }, [diagramVisible]);

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
        if (cancelled) return;
        if (!xml.trim()) throw new Error("empty bpmn");
        setBpmnXml(xml);
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
  }, [sessionId, showBpmn, bpmnRefreshKey, retry]);

  const count = blueprint.steps.length;

  if (!showBpmn) {
    return (
      <div className="max-w-3xl pb-2">
        {blueprint.goal && (
          <p className="mb-4 px-2 text-sm leading-relaxed text-text-secondary">
            <span className="font-medium text-text-strong">{t.wsBlueprintGoal}:</span> {blueprint.goal}
          </p>
        )}
        <StepListHeading t={t} count={count} />
        <StepListFlow blueprint={blueprint} t={t} typeLabel={typeLabel} />
      </div>
    );
  }

  function selectStep(stepId: string) {
    setSelectedStepId(stepId);
    if (!wide) setView("diagram");
    setFocusRequest((prev) => ({ stepId, seq: (prev?.seq ?? 0) + 1 }));
  }

  // "Kaavio" is the simple flow, "Avaa BPMN-kaaviona" the BPMN editor, "Lista" the steps alone.
  const viewButton = (key: "diagram" | "list" | "bpmn", icon: IconName, label: string) => {
    const shows = key === "bpmn" ? "bpmn" : "flow";
    const pressed = key === "list" ? !wide && view === "list" : diagramVisible && notation === shows;
    return (
      <button
        type="button"
        aria-pressed={pressed}
        onClick={() => {
          setView(key === "list" ? "list" : "diagram");
          if (key === "list" || notation === shows) return;
          setNotation(shows);
          lastNotation.set(sessionId, shows);
          // A step picked in one diagram is not carried to the other.
          setSelectedStepId(null);
          setFocusRequest(null);
        }}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
          pressed ? "bg-surface text-text-strong shadow-xs" : "text-text-muted hover:text-text"
        }`}
        data-testid={`flow-view-${key}`}
      >
        <Icon name={icon} size={14} />
        {label}
      </button>
    );
  };

  const viewSwitch = (
    <div
      role="group"
      aria-label={t.flowViewLabel}
      className="inline-flex shrink-0 self-start rounded-lg border border-border bg-surface-muted p-0.5"
    >
      {viewButton("diagram", "workflow", t.flowViewDiagram)}
      {!wide && viewButton("list", "list", t.flowViewList)}
      {viewButton("bpmn", "shapes", t.flowViewBpmn)}
    </div>
  );

  return (
    <div ref={rootRef} className="flex h-full min-h-[22rem] flex-col gap-3" data-flow-layout={wide ? "columns" : "switch"}>
      {!wide && viewSwitch}
      <div className="flex min-h-0 flex-1 gap-4">
        <div
          className={`min-h-0 flex-col ${
            wide ? "flex w-[280px] shrink-0" : view === "list" ? "flex w-full" : "hidden"
          }`}
        >
          {/* Beside the diagram the switch sits over the steps, so the diagram keeps the tab's whole height. */}
          {wide && <div className="mb-3 flex shrink-0">{viewSwitch}</div>}
          <StepListHeading t={t} count={count} />
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            <StepListFlow
              blueprint={blueprint}
              t={t}
              typeLabel={typeLabel}
              selectedStepId={selectedStepId}
              onSelectStep={notation === "flow" || bpmnXml ? selectStep : undefined}
            />
          </div>
        </div>
        <div className={`${diagramVisible ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col`}>
          {notation === "flow" ? (
            // Drawn from the blueprint, so it needs no diagram from the server;
            // off screen it is not kept, and it opens fitted each time.
            diagramVisible && (
              <WorkflowFlowView
                sessionId={sessionId}
                blueprint={blueprint}
                bpmnXml={bpmnXml}
                // The Blueprint tab's rule: after Gate 2 a change no longer matches the tested package.
                locked={wizardStep >= POC_STEP && !flowUnlocked}
                onUnlock={() => setFlowUnlocked(true)}
                pocNoteLabel={pocNoteLabel}
                selectedStepId={selectedStepId}
                onSelectedStepChange={setSelectedStepId}
                onSaved={(saved, via) => {
                  onBlueprintChange(saved);
                  onSaved(via);
                  // The BPMN is generated again from the saved blueprint.
                  setRetry((n) => n + 1);
                }}
                t={t}
              />
            )
          ) : fetchError ? (
            // No BPMN diagram: a way to try again; the simple flow and the list do not need it.
            <p className="px-2 text-xs text-text-muted" data-testid="flow-diagram-error">
              {t.wsBpmnError}{" "}
              <button
                type="button"
                className="font-medium text-brand-text underline underline-offset-2 hover:text-brand-strong"
                onClick={() => setRetry((n) => n + 1)}
              >
                {t.editorRetry}
              </button>
            </p>
          ) : bpmnXml && (diagramShown || diagramVisible) ? (
            <BpmnDiagramPanel
              sessionId={sessionId}
              xml={bpmnXml}
              blueprint={blueprint}
              steps={blueprint.steps}
              pocNoteLabel={pocNoteLabel}
              // Fetching again with a diagram on the canvas: the blueprint changed elsewhere.
              reloading={loading}
              focusRequest={focusRequest}
              onSelectedStepChange={setSelectedStepId}
              // Other tabs get a change once it is saved, never while it is being typed.
              onSynced={({ blueprint: synced }) => {
                onBlueprintChange(synced);
                onSaved("save");
              }}
              t={t}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-surface text-sm text-text-muted">
              {loading && t.wsBpmnLoading}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type Tab = WorkspaceTab;
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

const TAB_ICONS: Record<Tab, IconName> = {
  json: "braces",
  flow: "workflow",
  poc: "flaskConical",
};

/** sessionStorage, or null where reading it throws (blocked storage, some previews). */
function sessionStore(): PreflightStore | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * A preflight's stream read to its end (#252): the Job's phase and the log's
 * PROBLEM lines, and whether that is a finding about the package (`remember`).
 */
async function readPreflightStream(
  sessionId: string,
  runId: string,
): Promise<{ phase: "ok" | "failed" | "unfinished"; problems: string[]; reason?: string | null; remember: boolean }> {
  const res = await fetch(`/api/sessions/${sessionId}/runs/${encodeURIComponent(runId)}/stream`);
  if (!res.ok || !res.body) throw new Error("stream failed");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let buffer = "";
  // A stream that ends without a done event is a check that did not finish.
  let phase = "error";
  let message: string | null = null;
  try {
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
          phase = "error";
          message = evt.message ?? null;
        }
        if (evt.done) {
          phase = evt.phase ?? "error";
          message = evt.message ?? null;
        }
      }
    }
  } catch {
    // The stream broke: the findings read so far stand, otherwise the check
    // did not finish.
    phase = "error";
  }
  return { ...preflightOutcome(phase, lines, message), remember: preflightIsFinding(phase, lines) };
}

export function WorkspacePanel({
  sessionId,
  sessionTitle,
  wizardStep,
  gate2Approved = false,
  blueprint: initialBlueprint,
  hasSuccessfulRun = false,
  latestRun = null,
  wizardReplying: replyingAtLoad = false,
  reopenedAt = null,
  initialTab,
  t,
}: {
  sessionId: string;
  sessionTitle: string;
  wizardStep: number;
  /** Gate 2 is approved, so the PoC can be generated and run. */
  gate2Approved?: boolean;
  blueprint: Blueprint;
  /** wizard_api has recorded a successful sandbox run (#143); opens the deployable download. */
  hasSuccessfulRun?: boolean;
  /** The wizard is replying as the page loads (a reload mid-reply). */
  wizardReplying?: boolean;
  /** A gate is reopened and still waits; the value tells one reopening from the next. */
  reopenedAt?: string | null;
  /** The session's latest sandbox run; shown again when the page is reloaded. */
  latestRun?: string | null;
  /** The tab to open on (?tab=), e.g. "poc" when coming back from the case view. */
  initialTab?: Tab;
  t: Dict;
}) {
  // Työnkulku is a tab only once the diagram exists, and the PoC opens only
  // after Gate 2: wizard_api refuses to generate a package before it (409).
  const showFlow = shouldShowBpmnSpike(sessionId, wizardStep);
  const tabs = visibleTabs(showFlow);
  const phaseTab = tabForStep(wizardStep, showFlow);
  // The API refuses the package until Gate 2 is approved; a session can stand
  // on the Gate 2 step with the gate already approved.
  const pocLocked = wizardStep < POC_STEP && !gate2Approved;
  // The tab follows the phase on arrival (Gate 3 opens on the test run, not
  // on the diagram); a ?tab= and the user's own choice after that win.
  const [chosenTab, setTab] = useState<Tab>(() => initialTab ?? tabForStep(wizardStep, showFlow));
  const tab: Tab = tabs.includes(chosenTab) ? chosenTab : phaseTab;
  const pocActive = tab === "poc" && !pocLocked;
  const tabListRef = useRef<HTMLDivElement | null>(null);
  // The PoC's set-up column stays in view beside a long result only while it
  // fits the panel: a taller column that stuck would keep its last card, the
  // run button, below the fold until the result had been scrolled to its end.
  const pocPaneRef = useRef<HTMLDivElement | null>(null);
  const pocSetupRef = useRef<HTMLDivElement | null>(null);
  const [setupFits, setSetupFits] = useState(true);
  // The Blueprint tab reads first; the form opens on "Edit" and stays mounted
  // after "Done", so a draft not yet saved is still there on the next "Edit".
  const [blueprintEditing, setBlueprintEditing] = useState(false);
  const [editorMounted, setEditorMounted] = useState(false);
  // The form holds a draft it cannot save (an unnamed step, JSON that does not
  // parse, a failed save, a newer version to choose over). Behind the read
  // view that draft was out of sight and the read view showed the old
  // blueprint as if nothing were pending, so the form stays open until it is
  // saved, and comes back when a save fails after "Done".
  const [formStuck, setFormStuck] = useState(false);
  const [doneRefused, setDoneRefused] = useState(false);
  const blueprintEditingRef = useRef(blueprintEditing);
  blueprintEditingRef.current = blueprintEditing;
  useEffect(() => {
    // The note beside "Done" says why the form is open: it was brought back.
    setDoneRefused(formStuck && !blueprintEditingRef.current);
    if (formStuck) setBlueprintEditing(true);
  }, [formStuck]);
  // "Generate again" in the package details asks first: it replaces the package.
  const [regenConfirm, setRegenConfirm] = useState(false);
  // Output files whose text is open under their row.
  const [openFiles, setOpenFiles] = useState<ReadonlySet<string>>(() => new Set());
  // The control a click removes hands the focus on: "Edit" to "Done" and
  // back, "Generate again" to "Replace package".
  // "Edit" and "Done" take the focus as they are drawn, each from its own
  // ref: the form draws "Done" itself, and an effect here could run before
  // the button was there.
  const moveEditFocus = useRef(false);
  const takeEditFocus = (button: HTMLButtonElement | null) => {
    if (!button || !moveEditFocus.current || button.offsetParent === null) return;
    moveEditFocus.current = false;
    button.focus();
  };
  const regenReplaceRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (regenConfirm) regenReplaceRef.current?.focus();
  }, [regenConfirm]);
  const [blueprint, setBlueprint] = useState(initialBlueprint);
  // The page re-renders with the session's active blueprint after every chat
  // turn (router.refresh()); take it when its content changed, or the Plan
  // and Blueprint tabs keep the version the page first rendered with.
  const propBlueprintKeyRef = useRef(blueprintKey(initialBlueprint));
  const blueprintRef = useRef(blueprint);
  blueprintRef.current = blueprint;
  const [bpmnRefreshKey, setBpmnRefreshKey] = useState(0);
  useEffect(() => {
    const key = blueprintKey(initialBlueprint);
    if (key === propBlueprintKeyRef.current) return;
    propBlueprintKeyRef.current = key;
    // The diagram is drawn from the blueprint: for a version written
    // elsewhere (the agent, from the chat) it is drawn again, or the canvas
    // keeps the old steps and its next save writes them back. Not for the
    // version this panel saved itself and already shows.
    if (key !== blueprintKey(blueprintRef.current)) setBpmnRefreshKey((k) => k + 1);
    setBlueprint(initialBlueprint);
  }, [initialBlueprint]);
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
  const [pocInputs, setPocInputs] = useState<PocInputFile[]>([]);
  const [inputBusy, setInputBusy] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [runRecorded, setRunRecorded] = useState(hasSuccessfulRun);
  // Whether the wizard is replying (the chat says so): it may still be
  // writing the package, and a run started on a half-written one says nothing.
  const [wizardReplying, setWizardReplying] = useState(replyingAtLoad);
  // The package this tab last read may be older than the one on disk once a
  // reply has ended (the tab reads it again every fifteen seconds). A run
  // waits for one fresh read, so it never starts on a version the wizard has
  // just replaced, and is then started again for the new one.
  const [packageStale, setPackageStale] = useState(replyingAtLoad);
  // The package version the last run this page knows of started on (lib/poc-auto-run).
  const ranVersionRef = useRef<string | null>(null);
  // A run the tab started by itself found the sandbox full: it is asked for
  // again after the api's Retry-After, a few times, and meanwhile the step says so.
  const [autoRunWaiting, setAutoRunWaiting] = useState(false);
  const [autoRunRetry, setAutoRunRetry] = useState(0);
  const autoRunRetries = useRef(0);
  const autoRunTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (autoRunTimer.current !== null) window.clearTimeout(autoRunTimer.current);
    },
    [],
  );
  // The material the run in view was started on; unknown for a run from before a reload.
  const [runInputs, setRunInputs] = useState<string[]>([]);
  // The result shows where its values come from when the PoC traced them.
  const [showSources, setShowSources] = useState(true);
  // The set-up steps, once they are all done: folded to one line unless asked for.
  const [setupOpen, setSetupOpen] = useState(false);
  // Bumped when a run ends so the package state (and with it the recorded run)
  // is re-read from the api instead of trusted from the stream's last frame.
  const [pocRefresh, setPocRefresh] = useState(0);
  useEffect(() => {
    const onReplying = (e: Event) => {
      const replying = Boolean((e as CustomEvent<boolean>).detail);
      setWizardReplying(replying);
      if (replying) setPackageStale(true);
      // The read this starts replaces any that was on its way.
      else setPocRefresh((n) => n + 1);
    };
    window.addEventListener(CHAT_REPLYING_EVENT, onReplying);
    return () => window.removeEventListener(CHAT_REPLYING_EVENT, onReplying);
  }, []);
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

  // On a phone the tab row can be wider than the screen: the selected tab is
  // scrolled into the row's view. The row itself only, not the page around it
  // (a scrollIntoView moved the whole workspace, #35).
  useEffect(() => {
    const list = tabListRef.current;
    const el = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!list || !el) return;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    if (left < list.scrollLeft) list.scrollLeft = Math.max(0, left - 4);
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth + 4;
  }, [tab]);

  useEffect(() => {
    const pane = pocPaneRef.current;
    const setup = pocSetupRef.current;
    if (!pocActive || !pane || !setup || typeof ResizeObserver === "undefined") return;
    const update = () => setSetupFits(setup.offsetHeight <= pane.clientHeight);
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    observer.observe(setup);
    update();
    return () => observer.disconnect();
  }, [pocActive]);

  // When the PoC tab is open, load the generated file list. Re-runs after a
  // simulated run, when a sandbox run ends, and on the poll below, so a package
  // the agent finishes while the tab is open appears without a reload.
  useEffect(() => {
    if (!pocActive) return;
    let cancelled = false;
    fetch(`/api/sessions/${sessionId}/poc/files`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : NO_POC_PACKAGE))
      .then((d: unknown) => {
        if (cancelled) return;
        setPocLoaded(true);
        setPackageStale(false);
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
          setPackageStale(false);
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
  }, [pocActive, sessionId, pocStatus, pocRefresh]);

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
      onPocTab: pocActive,
      visible: pageVisible,
      ready: pocGenerated && pocReady,
      runActive,
    });
    if (delay === null) return;
    const timer = window.setTimeout(() => setPocRefresh((n) => n + 1), delay);
    return () => window.clearTimeout(timer);
  }, [pocActive, pageVisible, pocGenerated, pocReady, runActive, pocRefresh]);

  // The preflight (#252): as soon as a package is ready, and again whenever the
  // agent rewrites it, a sandbox Job imports what run_poc.py imports, builds each
  // stage's model config and loads the schema. It calls no model, so it needs no
  // input; what it finds is what would have failed the first run.
  //
  // Each check is remembered for this browser tab (sessionStorage): the PoC
  // tab is where a session at steps 10-13 opens, and a reload used to start a
  // new sandbox Job for a version already checked. A stored result is shown
  // again; a check still going when the page reloaded is followed by its run.
  useEffect(() => {
    if (
      !shouldStartPreflight({
        onPocTab: pocActive,
        ready: pocGenerated && pocReady,
        version: pocVersion,
        checkedVersion: checkedVersionRef.current,
      })
    ) {
      return;
    }
    const version = pocVersion as string;
    checkedVersionRef.current = version;
    const store = sessionStore();
    const stored = readStoredPreflight(store, sessionId);
    const known = stored && stored.version === version ? stored : null;
    if (known && known.phase !== "running") {
      setPreflight({ phase: known.phase, version, problems: known.problems });
      return;
    }
    void (async () => {
      setPreflight({ phase: "running", version, problems: [] });
      let runId = known?.runId ?? null;
      try {
        if (!runId) {
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
          runId = body.run_id as string;
          if (checkedVersionRef.current !== version) return;
          writeStoredPreflight(store, sessionId, { version, runId, phase: "running", problems: [] });
        }
        const { remember, ...outcome } = await readPreflightStream(sessionId, runId);
        // A newer version's check may have started meanwhile: what is stored
        // and shown is then that check's, not this older one's.
        if (checkedVersionRef.current !== version) return;
        writeStoredPreflight(
          store,
          sessionId,
          remember && outcome.phase !== "unfinished"
            ? { version, runId, phase: outcome.phase, problems: outcome.problems }
            : null,
        );
        setPreflight({ ...outcome, version });
      } catch {
        // The check was asked for and its start or stream was lost: it did
        // not finish. Forgotten, so the next visit (or "Check again") asks anew.
        if (checkedVersionRef.current !== version) return;
        writeStoredPreflight(store, sessionId, null);
        setPreflight({ ...unfinishedPreflight(), version });
      }
    })();
  }, [pocActive, sessionId, pocGenerated, pocReady, pocVersion, preflightRetry]);

  // Ask again for a check that did not finish: the version is unmarked so the
  // preflight effect runs once more.
  const retryPreflight = () => {
    checkedVersionRef.current = null;
    setPreflightRetry((n) => n + 1);
  };

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
    if (!pocActive || !pocGenerated) return;
    let cancelled = false;
    fetch(`/api/sessions/${sessionId}/poc/input`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((d: { files?: PocInputFile[] }) => {
        if (!cancelled) setPocInputs(Array.isArray(d.files) ? d.files : []);
      })
      .catch(() => {
        if (!cancelled) setPocInputs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pocActive, sessionId, pocStatus, pocGenerated]);

  const tabLabels: Record<Tab, string> = {
    json: t.wsTabJson,
    flow: t.wsTabFlow,
    poc: t.wsTabPoc,
  };

  const valueWords: ValueWords = {
    yes: t.pocResultYes,
    no: t.pocResultNo,
    percent: t.pocResultPercent,
  };

  const typeLabel = stepTypeLabels(t);

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
  async function runInSandbox(byItself = false) {
    ranVersionRef.current = pocVersion;
    if (!byItself) autoRunRetries.current = 0;
    if (autoRunTimer.current !== null) window.clearTimeout(autoRunTimer.current);
    autoRunTimer.current = null;
    setAutoRunWaiting(false);
    setRunInputs(pocInputs.map((f) => f.name));
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
        // A run nobody pressed for does not end in a red "sandbox is busy":
        // the step says it is waiting, and the run is asked for again.
        if (byItself && isSandboxBusy(response.status, body) && autoRunRetries.current < 5) {
          autoRunRetries.current += 1;
          setRunPhase("idle");
          setRunStartedAt(null);
          setAutoRunWaiting(true);
          autoRunTimer.current = window.setTimeout(
            () => setAutoRunRetry((n) => n + 1),
            retryAfterMs(response.headers.get("Retry-After")),
          );
          return;
        }
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
        { name: body.name as string, bytes: body.bytes as number, uploaded: true },
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

  // The test run starts by itself once the package is checked and its test
  // material is there, and again when the wizard has changed the package
  // (lib/poc-auto-run). Pressing "Run" was a step with nothing to decide.
  const hasEarlierRun = Boolean(latestRun) || runPhase !== "idle";
  // A reopened gate takes the earlier run with it, and the package is still
  // the one that run tested: the automatic run waits for the wizard's change
  // ("Run" stays for a user who wants it now). Kept for the browser tab, so a
  // reload does not take the changed package for the one to wait on.
  const [held, setHeld] = useState<{ at: string; version: string } | null>(null);
  if (reopenedAt && pocVersion !== null && held?.at !== reopenedAt) {
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(`poc-held:${sessionId}:${reopenedAt}`);
    } catch {
      // No storage: the version seen now is the one to wait on.
    }
    setHeld({ at: reopenedAt, version: stored ?? pocVersion });
  }
  const heldVersion = reopenedAt && held?.at === reopenedAt ? held.version : null;
  useEffect(() => {
    if (!held) return;
    try {
      window.sessionStorage.setItem(`poc-held:${sessionId}:${held.at}`, held.version);
    } catch {
      // Private mode: the hold lasts until a reload.
    }
  }, [held, sessionId]);
  const autoRunHeld = heldVersion !== null && heldVersion === pocVersion;
  // The run starts by itself only on the user's own files, not on examples
  // the wizard wrote into sample_input/ (lib/poc-auto-run userInputs).
  const ownInputs = userInputs(pocInputs);
  const autoRun = autoRunDecision({
    onPocTab: pocActive,
    gateApproved: gate2Approved,
    wizardReplying: wizardReplying || packageStale,
    packageStatus: packageState,
    version: pocVersion,
    hasInput: ownInputs.length > 0,
    busy: runActive || pocStatus === "running",
    ranVersion: ranVersionRef.current,
    hasEarlierRun,
    heldVersion,
  });
  useEffect(() => {
    if (autoRun === "adopt") ranVersionRef.current = pocVersion;
    // The run marks its version as it starts, so a second pass of this effect
    // (a development build runs effects twice) does not start another.
    if (autoRun === "run" && ranVersionRef.current !== pocVersion) void runInSandbox(true);
    // runInSandbox reads only refs, props and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, pocVersion]);
  // The sandbox had no room for a run the tab started: asked for again once
  // the wait is over, if the tab is still where it was.
  useEffect(() => {
    if (autoRunRetry === 0) return;
    autoRunTimer.current = null;
    if (!pocActive || wizardReplying || packageStale || runActive || pocStatus === "running") {
      setAutoRunWaiting(false);
      return;
    }
    // A newer package gets a run of its own (the effect above).
    if (packageState === "ready" && ranVersionRef.current === pocVersion) void runInSandbox(true);
    else setAutoRunWaiting(false);
    // Runs once per wait; what it reads is the tab's state when the wait ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunRetry]);
  // Said in the run step while that is what the tab is waiting for: the run
  // that is about to start, or the one thing it still needs.
  const firstRunAhead =
    !hasEarlierRun &&
    gate2Approved &&
    pocVersion !== null &&
    (packageState === "checking" || packageState === "ready");
  const autoRunComing = firstRunAhead && ownInputs.length > 0;
  const autoRunNeedsInput = firstRunAhead && ownInputs.length === 0;

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

  const records: RunRecord[] = !runOutput?.record
    ? []
    : Array.isArray(runOutput.record)
      ? runOutput.record
      : [runOutput.record];
  const table = recordTable(records, valueWords);
  const outputFiles = runOutput ? outputFileEntries(runOutput) : [];
  const trace = runOutput ? sourceTraceIn(runOutput) : null;
  // The sources are drawn under a record's own fields; a table of several
  // records and a document have no place for them.
  const sourcesDrawn = Boolean(trace) && !table && records.some((r) => !documentSections(r));
  const generating = pocStatus === "running";
  // 1 · A complete package with nothing wrong is one status line; its files,
  // the working copy and "Generate again" sit behind "Package details". That
  // holds while the check runs and where none can run, so the step does not
  // change shape when the check passes; missing files and a failed check keep
  // the step open with what is wrong. The user's own steps are the test files
  // and the run.
  const packageCollapsed =
    packageState === "ready" ||
    packageState === "checking" ||
    packageState === "unchecked" ||
    packageState === "unfinished";
  const showGenerationLog =
    logs.length > 0 && runPhase === "idle" && (!packageCollapsed || pocStatus !== "success");

  const downloadLink = pocReady && (
    <a
      href={`/api/sessions/${sessionId}/poc/download`}
      download
      title={t.pocDownloadHint}
      className="btn-secondary"
    >
      <Icon name="download" size={16} />
      {t.pocDownload}
    </a>
  );

  const packageStatusLine = (
    <span
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"
      data-testid="poc-package-status"
      data-state={packageState}
    >
      {/* One line for the files and the preflight together: the package is
          ready to run only once the check passed. */}
      {packageState === "loading" ? (
        <span>{t.pocLoading}</span>
      ) : packageState === "missing" ? (
        <span data-testid="poc-run-hint">{t.pocRunHint}</span>
      ) : packageState === "incomplete" ? (
        <span className="text-danger-text">{t.pocNotReadyTitle}</span>
      ) : packageState === "unchecked" ? (
        <span>{t.pocGeneratedTitle}</span>
      ) : packageState === "unfinished" ? (
        // Not a fault in the package: a neutral line and a way to ask again.
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="inline-flex items-center gap-1"
            data-testid="poc-check"
            data-phase={checkPhase}
            title={preflight.reason ?? undefined}
          >
            <Icon name="info" size={13} />
            {t.pocCheckUnfinished}
          </span>
          <button
            type="button"
            onClick={retryPreflight}
            className="inline-flex items-center gap-1 underline underline-offset-2"
            data-testid="poc-check-retry"
          >
            <Icon name="rotateCcw" size={12} />
            {t.pocCheckAgain}
          </button>
        </span>
      ) : (
        <span
          className={`inline-flex items-center gap-1 ${
            packageState === "failed" ? "text-danger-text" : packageState === "ready" ? "text-success-text" : ""
          }`}
          data-testid="poc-check"
          data-phase={checkPhase}
        >
          <Icon
            name={
              packageState === "checking" ? "loaderCircle" : packageState === "ready" ? "circleCheck" : "circleAlert"
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
        <span className="badge border-danger-border bg-danger-bg text-danger-text">{t.pocFailed}</span>
      )}
    </span>
  );

  const generateButton = (primary: boolean) => (
    <button
      type="button"
      onClick={runPoc}
      disabled={generating || runActive}
      className={primary ? "btn-brand" : "btn-ghost"}
    >
      <Icon
        name={generating ? "loaderCircle" : pocGenerated || logs.length > 0 ? "rotateCcw" : "package"}
        size={16}
        className={generating ? "animate-spin" : ""}
      />
      {generating ? t.pocRunning : pocGenerated || logs.length > 0 ? t.pocRerun : t.pocRun}
    </button>
  );

  const fileList = (
    <ul className="gap-x-6 font-mono text-xs text-text-muted @md:columns-2">
      {pocFiles.map((f) => (
        <li key={f} className="flex break-inside-avoid items-center gap-1.5 py-px" title={f}>
          <Icon name={fileIconFor(f)} size={13} className="shrink-0" />
          <span className="min-w-0 truncate">{f}</span>
        </li>
      ))}
    </ul>
  );

  const packageCard = (
    <StepCard
      n={1}
      title={t.pocStepPackage}
      // The same state the line beside it shows: not done while the check
      // runs, when it failed, or when none could run.
      done={packageState === "ready"}
      status={packageStatusLine}
      actions={
        !pocLoaded || packageCollapsed ? undefined : !pocGenerated ? (
          generateButton(true)
        ) : (
          <>
            {/* An incomplete package downloads and does nothing; the api
                says so (ready: false), so the link is withheld. */}
            {downloadLink}
            {generateButton(false)}
          </>
        )
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
        <div className="border-t border-border px-4 py-2.5 text-xs text-danger-text" data-testid="poc-check-problems">
          <p className="font-medium">{t.pocCheckFailed}</p>
          <ul className="mt-1 list-disc pl-5">
            {preflight.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {packageCollapsed ? (
        <details className="group border-t border-border" data-testid="poc-package-details">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-text-secondary transition-colors hover:text-text [&::-webkit-details-marker]:hidden">
            <Icon
              name="chevronRight"
              size={13}
              className="transition-transform duration-150 ease-out group-open:rotate-90"
            />
            {t.pocPackageDetails}
          </summary>
          <div className="flex flex-col gap-3 px-4 pb-3">
            {regenConfirm ? (
              <div className="flex flex-wrap items-center gap-2" data-testid="poc-regen-confirm">
                <span className="text-sm text-text-secondary">{t.pocRegenConfirm}</span>
                <button
                  ref={regenReplaceRef}
                  type="button"
                  className="btn-secondary"
                  disabled={generating || runActive}
                  onClick={() => {
                    setRegenConfirm(false);
                    void runPoc();
                  }}
                >
                  <Icon name="rotateCcw" size={16} />
                  {t.pocRegenReplace}
                </button>
                <button
                  type="button"
                  className="rounded-md px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:text-text"
                  onClick={() => setRegenConfirm(false)}
                >
                  {t.pocCancel}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {downloadLink}
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={generating || runActive}
                  onClick={() => setRegenConfirm(true)}
                >
                  <Icon
                    name={generating ? "loaderCircle" : "rotateCcw"}
                    size={16}
                    className={generating ? "animate-spin" : ""}
                  />
                  {generating ? t.pocRunning : t.pocRerun}
                </button>
              </div>
            )}
            {pocFiles.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-text-muted">
                  {t.pocFilesToggle.replace("{n}", String(pocFiles.length))}
                </span>
                {fileList}
              </div>
            )}
          </div>
        </details>
      ) : (
        pocFiles.length > 0 && (
          <details className="border-t border-border px-4 py-2.5">
            <summary className="cursor-pointer text-xs font-medium text-text-secondary">
              {t.pocFilesToggle.replace("{n}", String(pocFiles.length))}
            </summary>
            <div className="mt-2">{fileList}</div>
          </details>
        )
      )}
      {/* What generation printed, while it runs, and after it unless the
          package came out fine and folded away. */}
      {showGenerationLog && (
        <div className="border-t border-border p-3">
          <LogBox lines={logs} />
        </div>
      )}
    </StepCard>
  );

  // 2 · Sample input (#95): what the run reads. Without a file here a
  // document PoC fails at "No PDF files found".
  const inputsCard = (
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
          <label className={`btn-secondary ${inputBusy ? "opacity-60" : "cursor-pointer"}`}>
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
          <p className="border-t border-border px-4 py-2.5 text-xs text-text-muted">{t.pocInputsEmpty}</p>
        ) : (
          <ul className="scroll-thin max-h-64 divide-y divide-border overflow-y-auto border-t border-border">
            {pocInputs.map((f) => (
              <li key={f.name} className="flex items-center gap-3 py-1.5 pl-4 pr-2">
                <Icon name={fileIconFor(f.name)} size={16} className="text-text-muted" />
                <span className="min-w-0 flex-1 truncate text-sm text-text" title={`sample_input/${f.name}`}>
                  {f.name}
                </span>
                {f.uploaded === false && (
                  <span
                    className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-text-muted"
                    title={t.pocInputExampleHint}
                    data-testid="poc-input-example"
                  >
                    {t.pocInputExample}
                  </span>
                )}
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
  );

  // 3 · The real run (#94). Enabled only once a package exists — a run with
  // nothing to run is the state the old simulated button reported as success.
  // What it produced is the result card beside it (below it on a narrow panel).
  const runCard = (
    <StepCard
      n={3}
      title={t.pocStepRun}
      done={runPhase === "succeeded"}
      muted={!pocGenerated}
      status={
        runPhase === "idle" ? (
          pocGenerated ? (
            autoRunWaiting ? (
              <span data-testid="poc-auto-run">{t.pocAutoRunBusy}</span>
            ) : autoRunHeld ? (
              <span data-testid="poc-auto-run">{t.pocAutoRunHeld}</span>
            ) : autoRunComing ? (
              <span data-testid="poc-auto-run">{t.pocAutoRun}</span>
            ) : autoRunNeedsInput ? (
              <span data-testid="poc-auto-run">{t.pocAutoRunNeedsInput}</span>
            ) : (
              t.pocIdle
            )
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
              name={runActive ? "loaderCircle" : runPhase === "succeeded" ? "circleCheck" : "circleAlert"}
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
          onClick={() => void runInSandbox()}
          disabled={!pocGenerated || !pocReady || runActive}
          title={!pocGenerated || !pocReady ? t.pocRunSandboxHint : undefined}
          className={
            pocGenerated && pocReady && !checkFailed && runPhase !== "succeeded" ? "btn-brand" : "btn-secondary"
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
    />
  );

  // The run's result: the records, the document, the files, then the log.
  // Before the first run a wide panel keeps its place with one line; a narrow
  // one shows nothing until there is something to show.
  const resultCard = (
    <section
      className={`rounded-lg border border-border bg-surface ${runPhase === "idle" ? "hidden @min-[960px]:block" : ""}`}
      aria-labelledby={`${baseId}-result`}
      data-testid="poc-result"
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <h3 id={`${baseId}-result`} className="text-sm font-semibold text-text">
          {t.pocResultTitle}
        </h3>
        {runOutput?.validation && (
          <span
            className={runOutput.validation.passed ? "badge-success" : "badge-warning"}
            data-testid="poc-run-grounding"
          >
            {runOutput.validation.passed ? t.pocResultChecksOk : t.pocResultChecksBad}
          </span>
        )}
        {/* Where the values come from: how many of the model's citations the
            check found in the source, and the snippets under each value. */}
        {trace && sourcesDrawn && (
          <span className="ml-auto flex items-center gap-2 text-xs text-text-secondary">
            <span data-testid="poc-sources-summary">
              {t.pocSources.summary
                .replace("{verified}", String(trace.verified))
                .replace("{total}", String(trace.total))}
            </span>
            <button
              type="button"
              onClick={() => setShowSources((on) => !on)}
              data-testid="poc-sources-toggle"
              className="rounded-md px-2 py-1 font-medium text-brand-text transition-colors hover:bg-brand-soft"
            >
              {showSources ? t.pocSources.hide : t.pocSources.show}
            </button>
          </span>
        )}
      </div>
      {/* Which material the result is of, so two runs are not mistaken for one. */}
      {runOutput && runInputs.length > 0 && (
        <p className="-mt-2 px-4 pb-2.5 text-xs text-text-muted" data-testid="poc-result-from">
          {t.pocResultFrom.replace("{files}", runInputs.join(", "))}
        </p>
      )}

      {runPhase === "idle" && (
        <p
          className="border-t border-border px-4 py-12 text-center text-sm text-text-muted"
          data-testid="poc-result-empty"
        >
          {t.pocResultEmpty}
        </p>
      )}

      {/* Why the run ended the way it did: the reason the api read from the
          log's last lines (the exception under the traceback), or the Job's
          words when the log says nothing. */}
      {(runPhase === "error" || runPhase === "failed" || runPhase === "timeout") && (
        <div className="border-t border-border px-4 py-2.5" role="alert" data-testid="poc-run-message">
          <p className="break-words rounded-md border border-danger-border bg-danger-bg px-3 py-2 font-mono text-xs text-danger-text">
            {runMessage || RUN_PHASE_LABEL[runPhase]}
          </p>
        </div>
      )}

      {runOutput && (
        <div className="flex flex-col gap-4 border-t border-border px-4 py-3" data-testid="poc-run-output">
          {!hasRunOutput(runOutput) && <p className="text-xs text-text-muted">{t.pocResultNone}</p>}

          {table ? (
            // Several flat records: one table, a row each. The first column
            // stays put while a phone scrolls the rest sideways; there it is
            // kept narrow (the name wraps, the review mark goes under it) so
            // the columns beside it have room.
            <div className="scroll-thin overflow-x-auto rounded-md border border-border" data-testid="poc-run-table">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    {table.columns.map((c, j) => (
                      <th
                        key={c.field}
                        scope="col"
                        className={`whitespace-nowrap border-b border-border bg-surface-muted px-3 py-2 text-left text-xs font-medium text-text-secondary ${
                          j === 0 ? "sticky left-0 z-10 border-r" : ""
                        }`}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, i) => (
                    <tr key={i} data-testid="poc-run-record" data-flagged={row.flagged ? "true" : undefined}>
                      {row.cells.map((cell, j) => {
                        const edge = i > 0 ? "border-t border-border" : "";
                        const wrap = cell.length > 40 ? "min-w-[16rem]" : "whitespace-nowrap";
                        return j === 0 ? (
                          <th
                            key={j}
                            scope="row"
                            className={`sticky left-0 z-10 border-r border-border bg-surface px-3 py-2 text-left align-top font-medium text-text ${edge}`}
                          >
                            <span className="flex items-center gap-2 @max-[640px]:max-w-[9rem] @max-[640px]:flex-col @max-[640px]:items-start @max-[640px]:gap-1">
                              <span
                                className={`${wrap} @max-[640px]:min-w-0 @max-[640px]:whitespace-normal @max-[640px]:break-words`}
                              >
                                {cell}
                              </span>
                              {row.flagged && (
                                <span className="badge-warning whitespace-nowrap py-px">
                                  <Icon name="circleAlert" size={12} />
                                  {t.pocResultNeedsReview}
                                </span>
                              )}
                            </span>
                          </th>
                        ) : (
                          <td key={j} className={`px-3 py-2 align-top text-text ${edge} ${wrap}`}>
                            {cell}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            records.map((record, i, all) => {
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
                        {recordRows(record, valueWords).map((row) => (
                          <tr key={row.field} className="border-t border-border align-top">
                            <th
                              scope="row"
                              className="w-px whitespace-nowrap py-1.5 pr-6 text-left font-medium text-text-muted"
                            >
                              {row.label}
                            </th>
                            <td className="whitespace-pre-wrap break-words py-1.5 text-text">
                              {row.table ? <NestedTableView table={row.table} /> : row.value}
                              {showSources && (
                                <FieldSources
                                  sources={sourcesForField(trace, row.field, i, records)}
                                  labels={t.pocSources}
                                />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })
          )}

          {runOutput.document && (
            <details open>
              <summary className="cursor-pointer text-sm font-semibold text-text">{t.pocResultDocument}</summary>
              <p className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-app p-3 text-sm text-text">
                {runOutput.document}
              </p>
            </details>
          )}
          {runOutput.transcript && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-text">{t.pocResultTranscript}</summary>
              <p className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-app p-3 text-sm text-text">
                {runOutput.transcript}
              </p>
            </details>
          )}

          {(outputFiles.length > 0 || runOutput.skipped.length > 0) && (
            <div className="flex flex-col gap-1.5">
              <h4 className="text-xs font-medium text-text-muted">{t.pocResultFiles}</h4>
              {outputFiles.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border" data-testid="poc-run-downloads">
                  {outputFiles.map((f) => {
                    const open = openFiles.has(f.name);
                    const bodyId = `${baseId}-file-${f.name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
                    return (
                      <li key={f.name}>
                        <div className="flex items-center gap-2 py-1 pl-3 pr-1">
                          <Icon name={fileIconFor(f.name)} size={15} className="text-text-muted" />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text" title={f.name}>
                            {f.name}
                          </span>
                          {f.size !== null && (
                            <span className="shrink-0 text-xs text-text-muted">{formatSize(f.size)}</span>
                          )}
                          {f.body !== null && (
                            <button
                              type="button"
                              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-brand-text transition-colors hover:bg-brand-soft"
                              aria-expanded={open}
                              aria-controls={bodyId}
                              aria-label={`${open ? t.pocResultHide : t.pocResultShow} ${f.name}`}
                              onClick={() =>
                                setOpenFiles((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(f.name)) next.delete(f.name);
                                  else next.add(f.name);
                                  return next;
                                })
                              }
                            >
                              {open ? t.pocResultHide : t.pocResultShow}
                            </button>
                          )}
                          {f.downloadable && runOutput.runId && (
                            <a
                              href={runFileHref(sessionId, runOutput.runId, f.name)}
                              download={f.name}
                              className="icon-btn"
                              aria-label={t.pocResultDownloadFile.replace("{name}", f.name)}
                              title={t.pocResultDownloadFile.replace("{name}", f.name)}
                            >
                              <Icon name="download" size={15} />
                            </a>
                          )}
                        </div>
                        {open && f.body !== null && (
                          <pre
                            id={bodyId}
                            className="scroll-thin mx-3 mb-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-app p-2 font-mono text-xs text-text"
                          >
                            {f.body}
                          </pre>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {runOutput.skipped.map((f) => (
                <p key={f.name} className="text-xs text-text-muted">
                  {t.pocResultSkipped.replace("{name}", f.name).replace("{size}", formatSize(f.size))}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Gate 3 is a loop (#96): the agent reads this run's log and output
          with the next chat message, so the way to change the PoC is to say
          what is wrong there and run it again. */}
      {!runActive && runPhase !== "idle" && (
        <p className="border-t border-border px-4 py-2.5 text-xs text-text-muted" data-testid="poc-refine-hint">
          {t.pocRefineHint}
        </p>
      )}

      {/* The log: live while the run goes, folded once it is over. Nothing is
          drawn before the first line arrives. */}
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
    </section>
  );

  // 4 · The hand-over (#143): wizard_api serves the deployable zip only
  // after a run it recorded as successful.
  const useCard = (
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
            // In its own tab: the session, and a chat reply that may be on its
            // way, stay open here while the solution is tried there.
            target="_blank"
            rel="noopener"
            className="btn-secondary"
            title={t.pocOpenCasesHint}
            data-testid="poc-open-cases"
          >
            <Icon name="users" size={16} />
            {t.pocOpenCases}
            <Icon name="externalLink" size={14} className="text-text-muted" />
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
  );

  // Package checked, material in, run succeeded: the three set-up steps have
  // nothing left to ask, so one line stands for them (with "run again") and
  // the result starts where they were. A new run brings them back while it goes.
  // Only for the package that run was of: a package the wizard has rewritten
  // since, or one whose check has not ended, keeps its card (and "check again").
  const setupDone =
    pocGenerated &&
    pocReady &&
    packageState === "ready" &&
    !packageStale &&
    pocInputs.length > 0 &&
    runPhase === "succeeded";
  const setupFolded = setupDone && !setupOpen;
  const setupSummary = setupDone && (
    <section
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-4 py-2.5"
      data-testid="poc-setup-summary"
    >
      <span
        className="inline-flex items-center gap-1.5 text-sm font-medium text-success-text"
        data-testid={setupFolded ? "poc-run-phase" : undefined}
      >
        <Icon name="circleCheck" size={15} />
        {RUN_PHASE_LABEL.succeeded}
      </span>
      <span className="text-xs text-text-muted">
        {pocInputs.length === 1
          ? t.pocSetupFilesOne
          : t.pocSetupFilesMany.replace("{n}", String(pocInputs.length))}
      </span>
      <span className="ml-auto flex flex-wrap items-center gap-1">
        {setupFolded && (
          <button
            type="button"
            onClick={() => {
              void runInSandbox();
              // The line unmounts as the run starts: keep the focus in the
              // steps it turns into, not on <body>.
              requestAnimationFrame(() => pocSetupRef.current?.focus());
            }}
            className="btn-secondary"
            data-testid="poc-run-sandbox"
          >
            <Icon name="rotateCcw" size={16} />
            {t.pocRunAgain}
          </button>
        )}
        <button
          type="button"
          onClick={() => setSetupOpen((open) => !open)}
          aria-expanded={!setupFolded}
          className="rounded-md px-2 py-1.5 text-xs font-medium text-brand-text transition-colors hover:bg-brand-soft"
          data-testid="poc-setup-toggle"
        >
          {setupFolded ? t.pocSetupShow : t.pocSetupHide}
        </button>
      </span>
    </section>
  );

  // The Blueprint tab's first row while reading: "Muokkaa" where "Valmis" is
  // while editing. After Gate 2 a change no longer matches the tested package,
  // and the row says so in the Workflow tab's words for the same state.
  const editNoteId = `${baseId}-edit-note`;
  const editAction = (
    <BlueprintModeBar
      mode="read"
      control={
        <button
          ref={takeEditFocus}
          type="button"
          className="btn-secondary"
          onClick={() => {
            moveEditFocus.current = true;
            setEditorMounted(true);
            setBlueprintEditing(true);
          }}
          aria-describedby={wizardStep >= POC_STEP ? editNoteId : undefined}
          data-testid="blueprint-edit"
        >
          <Icon name="pencil" size={15} />
          {t.planEdit}
        </button>
      }
    >
      {wizardStep >= POC_STEP && (
        <p
          id={editNoteId}
          className="flex min-w-0 flex-1 basis-64 items-start gap-1.5 text-xs text-text-secondary"
          data-testid="blueprint-edit-note"
        >
          <Icon name="lock" size={13} className="mt-0.5 shrink-0 text-text-muted" />
          <span>{t.flowLocked}</span>
        </p>
      )}
    </BlueprintModeBar>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <div
          ref={tabListRef}
          role="tablist"
          aria-label={t.workspace}
          className="scroll-thin relative flex w-fit max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden rounded-lg border border-border bg-surface-muted/70 p-1"
        >
          {tabs.map((key) => {
            const tabId = `${baseId}-tab-${key}`;
            const panelId = `${baseId}-panel-${key}`;
            const active = tab === key;
            const locked = key === "poc" && pocLocked;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={tabId}
                aria-selected={active}
                aria-controls={panelId}
                // Why the PoC is locked is said once, in the tab itself.
                title={locked ? undefined : t.wsTabHints[key]}
                onClick={() => setTab(key)}
                className={`focus-inset inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150 ease-out ${
                  active
                    ? "bg-surface text-text-strong shadow-sm"
                    : "text-text-muted hover:bg-surface/60 hover:text-text"
                }`}
              >
                <Icon name={locked ? "lock" : TAB_ICONS[key]} size={15} />
                {tabLabels[key]}
                {locked && <span className="sr-only">({t.wsTabLocked})</span>}
                {/* Where the session's current phase is, while another tab is open:
                    the session opens on that tab, so the open tab needs no mark. */}
                {key === phaseTab && !active && (
                  <>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden data-testid="tab-now" />
                    <span className="sr-only">({t.wsTabNow})</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
        {/* Every tab shows AI output, so the notice sits once, beside the tabs
            and under them where there is no room (AI Act art. 50). */}
        <p className="min-w-0 flex-1 basis-72 text-xs text-text-muted" data-testid="workspace-ai-mark">
          {t.wsAiMark}
        </p>
      </div>

      {tabs.map((key) => {
        const tabId = `${baseId}-tab-${key}`;
        const panelId = `${baseId}-panel-${key}`;
        return (
          <div
            key={key}
            role="tabpanel"
            id={panelId}
            aria-labelledby={tabId}
            hidden={tab !== key}
            ref={key === "poc" ? pocPaneRef : undefined}
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
              <>
                {!blueprintEditing && <SolutionPlanView blueprint={blueprint} t={t} action={editAction} />}
                {editorMounted && (
                  <div className={blueprintEditing ? "" : "hidden"}>
                    <div>
                      <BlueprintJsonEditor
                        control={
                          <button
                            ref={takeEditFocus}
                            type="button"
                            className="btn-secondary"
                            onClick={() => {
                              if (formStuck) {
                                setDoneRefused(true);
                                return;
                              }
                              moveEditFocus.current = true;
                              setBlueprintEditing(false);
                            }}
                            data-testid="blueprint-done"
                          >
                            <Icon name="check" size={16} />
                            {t.planDone}
                          </button>
                        }
                        controlNote={
                          // Why "Done" did not close the form; the form's own line says what is wrong.
                          <p
                            role="status"
                            className="text-right text-xs text-warning-text empty:hidden"
                            data-testid="blueprint-done-unsaved"
                          >
                            {doneRefused && formStuck ? t.formDoneUnsaved : null}
                          </p>
                        }
                        sessionId={sessionId}
                        blueprint={blueprint}
                        onSaved={(saved) => {
                          setBlueprint(saved);
                          setBpmnRefreshKey((k) => k + 1);
                          noteBlueprintSaved("save");
                        }}
                        onStuckChange={setFormStuck}
                        pocNoteLabel={pocNote}
                        t={t}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {key === "poc" &&
              (pocLocked ? (
                <div
                  className="flex max-w-xl items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3.5"
                  data-testid="poc-locked"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-text-muted">
                    <Icon name="lock" size={16} />
                  </span>
                  <p className="text-sm text-text-secondary">{t.pocLocked}</p>
                </div>
              ) : (
                // Wide panel (chat closed on a laptop): the set-up steps in a
                // sticky left column, the result at full width beside them.
                // The chat dock changes the width, so this asks the panel.
                <div className="@container pb-2">
                  <div className="grid gap-3 @min-[960px]:grid-cols-[22.5rem_minmax(0,1fr)] @min-[960px]:items-start">
                    <div
                      ref={pocSetupRef}
                      tabIndex={-1}
                      className={`flex min-w-0 flex-col gap-3 outline-none ${setupFits ? "@min-[960px]:sticky @min-[960px]:top-0" : ""}`}
                    >
                      {setupSummary}
                      {!setupFolded && (
                        <>
                          {packageCard}
                          {inputsCard}
                          {runCard}
                        </>
                      )}
                      {/* With the other steps, not under the result: a long
                          result pushed "try it" below the fold. */}
                      {useCard}
                    </div>
                    <div className="flex min-w-0 flex-col gap-3">{resultCard}</div>
                  </div>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
