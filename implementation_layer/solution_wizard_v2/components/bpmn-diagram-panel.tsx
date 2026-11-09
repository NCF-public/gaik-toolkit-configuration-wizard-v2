"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  BpmnModeler,
  type BpmnEditState,
  type BpmnModelerHandle,
  type BpmnSelectionInfo,
} from "@/components/bpmn-modeler";
import { BpmnZoomControls } from "@/components/bpmn-viewer-toolbar";
import { AskStepButton, StepNumber, StepTypeTag, stepTypeLabels } from "@/components/step-type";
import { Icon } from "@/components/icons";
import {
  bpmnSemantics,
  stepIdToBpmnId,
  stepIndexForBpmnId,
  stripTaskCodePrefixes,
  type ModdleElement,
} from "@/lib/bpmn-edit-state";
import { fillTemplate } from "@/lib/chat-template";
import type { Dict } from "@/lib/i18n";
import type { Blueprint, BlueprintStep } from "@/lib/mock-sessions";

const NO_EDITS: BpmnEditState = { kind: "none", problems: { unconnected: [], unnamed: [] } };

/** How long a rename in the name field waits for more typing before it saves itself. */
const RENAME_SAVE_DELAY_MS = 800;

/** From this canvas width (Tailwind's @lg container, 32rem) the properties panel is a column at the right. */
const PROPS_WIDE = 512;

/**
 * Canvas edits not saved yet, per session, kept while the tab is closed: the
 * Workflow tab unmounts when another tab opens, and its unsaved edits were
 * lost. `base` is the diagram they were made on; a different diagram from the
 * server drops them.
 */
const drafts = new Map<string, { base: string; xml: string }>();

type SaveState = "idle" | "saving" | "saved" | "error" | "lint";

export function BpmnDiagramPanel({
  sessionId,
  xml,
  steps,
  pocNoteLabel = null,
  focusRequest = null,
  onSelectedStepChange,
  onSynced,
  t,
}: {
  sessionId: string;
  /** The diagram as the server generated it from the blueprint. */
  xml: string;
  /** The blueprint's steps: their numbers, types and the chat reference. */
  steps: BlueprintStep[];
  /** Shown while saved changes are not in the PoC package yet. */
  pocNoteLabel?: string | null;
  /** Select and centre this step's task (a click on the step list). */
  focusRequest?: { stepId: string; seq: number } | null;
  /** The step whose task is selected on the canvas, for the step list. */
  onSelectedStepChange?: (stepId: string | null) => void;
  /** After a save: the blueprint and diagram as the server has them now. */
  onSynced: (result: { blueprint: Blueprint; xml: string }) => void;
  t: Dict;
}) {
  const modelerRef = useRef<BpmnModelerHandle>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const propsTitleId = useId();

  // The diagram on the canvas: the server's, a draft kept from before the tab
  // closed, or the server's answer to a save.
  const restored = useRef(drafts.get(sessionId)?.base === xml ? drafts.get(sessionId) : undefined);
  const [shownXml, setShownXml] = useState(restored.current?.xml ?? xml);
  const [importKey, setImportKey] = useState(0);
  const propXml = useRef(xml);
  useEffect(() => {
    if (propXml.current === xml) return;
    propXml.current = xml;
    drafts.delete(sessionId);
    setShownXml(xml);
  }, [xml, sessionId]);

  const [selection, setSelection] = useState<BpmnSelectionInfo>(null);
  const [editName, setEditName] = useState("");
  const [propsClosed, setPropsClosed] = useState(false);
  const [edit, setEdit] = useState<BpmnEditState>(NO_EDITS);
  const [zoom, setZoom] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lint, setLint] = useState<{ errors: string[]; warnings: string[] }>({ errors: [], warnings: [] });
  const saving = useRef(false);
  const pendingFocus = useRef<string | null>(null);

  const selectedId = selection?.id ?? null;
  const stepIndex = stepIndexForBpmnId(steps, selectedId);
  const step = stepIndex >= 0 ? steps[stepIndex] : null;
  const typeLabel = stepTypeLabels(t);

  // A new element in the name field; the same one keeps what is typed.
  useEffect(() => {
    setEditName(selection?.name ?? "");
    setPropsClosed(false);
    // Only a different element replaces the field's text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const stepId = step?.id ?? null;
  const onSelectedStep = useRef(onSelectedStepChange);
  onSelectedStep.current = onSelectedStepChange;
  useEffect(() => {
    onSelectedStep.current?.(stepId);
  }, [stepId]);

  /**
   * What the properties panel covers once a step is picked, so the step is
   * centred beside it: the panel sits at the canvas's right edge, or across
   * its top when the canvas is narrow (PROPS_WIDE, the panel's own breakpoint).
   */
  function propsCover() {
    const width = canvasRef.current?.clientWidth ?? 0;
    return width >= PROPS_WIDE ? { right: 312 } : { top: 216 };
  }

  useEffect(() => {
    if (!focusRequest) return;
    const id = stepIdToBpmnId(focusRequest.stepId);
    if (!modelerRef.current?.focusElement(id, propsCover())) pendingFocus.current = id;
  }, [focusRequest]);

  function onImported() {
    const m = modelerRef.current;
    if (!m) return;
    if (pendingFocus.current && m.focusElement(pendingFocus.current, propsCover())) pendingFocus.current = null;
    // A draft from before the tab closed: compare it with the server's diagram it was made on.
    const draft = restored.current;
    if (draft) {
      restored.current = undefined;
      import("bpmn-moddle")
        // Names as the canvas shows them, or every prefixed task would count as renamed.
        .then(({ BpmnModdle }) => new BpmnModdle().fromXML(stripTaskCodePrefixes(draft.base)))
        .then(({ rootElement }) => m.setBase(bpmnSemantics(rootElement as ModdleElement)))
        .catch(() => drafts.delete(sessionId));
    }
  }

  // Keep unsaved edits for when the tab opens again, and ask before the page closes on them.
  useEffect(() => {
    if (edit.kind === "none") {
      drafts.delete(sessionId);
      return;
    }
    const base = propXml.current;
    modelerRef.current
      ?.saveXml()
      .then((draftXml) => drafts.set(sessionId, { base, xml: draftXml }))
      .catch(() => {});
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [edit, sessionId]);

  const blocked = edit.problems.unconnected.length > 0 || edit.problems.unnamed.length > 0;

  async function save() {
    const m = modelerRef.current;
    if (!m || saving.current) return;
    saving.current = true;
    setSaveState("saving");
    setLint({ errors: [], warnings: [] });
    const revision = m.revision();
    const sent = m.semantics();
    try {
      const body = await m.saveXml();
      const res = await fetch(`/api/sessions/${sessionId}/bpmn/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml: body }),
      });
      const data = (await res.json().catch(() => null)) as {
        blueprint?: Blueprint;
        xml?: string;
        lint?: {
          errors?: { rule: string; id: string; message: string }[];
          warnings?: { rule: string; id: string; message: string }[];
        };
        error?: string;
      } | null;
      const lines = (list?: { rule: string; id: string; message: string }[]) =>
        (list ?? []).map((e) => `${e.rule}${e.id ? ` (${e.id})` : ""}: ${e.message}`);

      if (res.status === 422 && data?.error === "bpmn_lint_failed") {
        setLint({ errors: lines(data.lint?.errors), warnings: lines(data.lint?.warnings) });
        setSaveState("lint");
        return;
      }
      if (!res.ok || !data?.blueprint || !data.xml) throw new Error("sync failed");
      drafts.delete(sessionId);
      onSynced({ blueprint: data.blueprint, xml: data.xml });
      if (m.revision() === revision) {
        // The server's diagram, as the blueprint now generates it.
        propXml.current = data.xml;
        setShownXml(data.xml);
        setImportKey((k) => k + 1);
      } else {
        // Typing went on during the save: keep it, compared with what was saved.
        m.setBase(sent);
      }
      setSaveState("saved");
    } catch {
      setSaveState("error");
    } finally {
      saving.current = false;
    }
  }

  // A rename saves itself once the typing stops; other edits wait for "Tallenna muutokset".
  useEffect(() => {
    if (edit.kind !== "rename" || blocked) return;
    const timer = window.setTimeout(() => void save(), RENAME_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
    // save reads refs and the current props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, blocked]);

  function applyNameChange(next: string) {
    setEditName(next);
    modelerRef.current?.updateSelectedName(next);
  }

  const showProps = Boolean(selection) && !propsClosed;
  const typeName = (type: string) => t.wsBpmnTypeNames[`bpmn:${type}`] ?? type;
  const problemText = edit.problems.unconnected.length
    ? fillTemplate(t.bpmnUnconnected, {
        names: edit.problems.unconnected.map((p) => p.name || p.id).join(", "),
      })
    : edit.problems.unnamed.length
      ? t.bpmnUnnamed
      : null;

  // The one line that says where the diagram stands; nothing when there is nothing to say.
  let status: ReactNode = null;
  if (saveState === "saving") {
    status = (
      <span className="inline-flex items-center gap-1.5 text-text-muted">
        <Icon name="loaderCircle" size={14} className="motion-safe:animate-spin" />
        {t.wsBpmnSaving}
      </span>
    );
  } else if (edit.kind !== "none" && problemText) {
    status = <span className="text-warning-text">{problemText}</span>;
  } else if (saveState === "lint") {
    status = <span className="text-danger-text">{t.wsBpmnLintBlocked}</span>;
  } else if (saveState === "error") {
    status = (
      <span className="inline-flex items-center gap-2 text-danger-text">
        {t.wsBpmnSaveError}
        <button type="button" className="font-medium underline underline-offset-2" onClick={() => void save()}>
          {t.editorRetry}
        </button>
      </span>
    );
  } else if (edit.kind === "structure") {
    status = (
      <span className="inline-flex items-center gap-1.5 text-text-secondary">
        <span className="h-2 w-2 rounded-full bg-warning-text" aria-hidden="true" />
        {t.bpmnUnsaved}
      </span>
    );
  } else if (saveState === "saved") {
    status = (
      <span className="inline-flex items-center gap-1.5 text-text-muted">
        <Icon name="check" size={14} className="text-success-text" />
        {t.wsBpmnSaved}
      </span>
    );
  }

  return (
    <section className="relative flex h-full min-h-0 w-full flex-col" aria-label={t.wsTabFlow}>
      <div
        ref={canvasRef}
        className="@container relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface"
      >
        <BpmnModeler
          ref={modelerRef}
          xml={shownXml}
          importKey={importKey}
          ariaLabel={t.wsTabFlow}
          loadErrorLabel={t.wsBpmnError}
          editorLabels={{
            addTask: t.bpmnPaletteAddTask,
            connect: t.bpmnPaletteConnect,
            rename: t.bpmnPadRename,
            remove: t.bpmnPadDelete,
          }}
          onSelectionChange={setSelection}
          onEditStateChange={setEdit}
          onZoomChange={setZoom}
          onImported={onImported}
        />

        <BpmnZoomControls
          className="absolute right-3 top-3 z-10"
          zoom={zoom}
          onZoomIn={() => modelerRef.current?.zoomIn()}
          onZoomOut={() => modelerRef.current?.zoomOut()}
          onFit={() => modelerRef.current?.fit()}
          zoomInLabel={t.wsBpmnZoomIn}
          zoomOutLabel={t.wsBpmnZoomOut}
          fitLabel={t.bpmnFitView}
          groupLabel={t.wsBpmnToolbar}
        />

        {showProps && selection && (
          <aside
            className="pop-in absolute inset-x-3 top-14 z-10 rounded-lg border border-border bg-surface p-3 shadow-md @lg:left-auto @lg:w-72"
            aria-labelledby={propsTitleId}
            data-testid="bpmn-properties"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 id={propsTitleId} className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text-strong">
                {step ? (
                  <>
                    <StepNumber n={stepIndex + 1} type={step.type} />
                    {fillTemplate(t.bpmnStepTitle, { n: String(stepIndex + 1) })}
                  </>
                ) : (
                  typeName(selection.type)
                )}
              </h4>
              <button
                type="button"
                className="icon-btn h-7 w-7"
                onClick={() => setPropsClosed(true)}
                aria-label={t.wsBpmnPropertiesClose}
                title={t.wsBpmnPropertiesClose}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-muted">{t.wsBpmnPropertiesName}</span>
              <input
                type="text"
                className="input-field w-full text-sm"
                value={editName}
                onChange={(e) => applyNameChange(e.target.value)}
                data-testid="bpmn-property-name"
              />
            </label>
            {step && (
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted">
                  <span className="sr-only">{t.wsBpmnPropertiesType}: </span>
                  <StepTypeTag type={step.type} label={typeLabel[step.type]} />
                </span>
                <AskStepButton step={step} index={stepIndex} t={t} withLabel testId="bpmn-ask-step" />
              </div>
            )}
          </aside>
        )}

        {(status || edit.kind === "structure" || pocNoteLabel || lint.errors.length > 0) && (
          <div
            className="pop-in absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col gap-1.5 rounded-lg border border-border bg-surface/95 px-3 py-2 text-xs shadow-sm backdrop-blur-sm sm:max-w-md"
            data-testid="bpmn-status"
          >
            {(status || edit.kind === "structure") && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" role="status">
                {status}
                {edit.kind === "structure" && (
                  <button
                    type="button"
                    className="btn-brand px-3 py-1 text-xs"
                    onClick={() => void save()}
                    disabled={blocked || saveState === "saving"}
                    data-testid="bpmn-save"
                  >
                    {t.wsBpmnSave}
                  </button>
                )}
              </div>
            )}
            {lint.errors.length > 0 && (
              <ul className="max-h-32 list-disc space-y-0.5 overflow-auto pl-4 text-danger-text" role="alert">
                {lint.errors.map((msg) => (
                  <li key={msg}>{msg}</li>
                ))}
              </ul>
            )}
            {lint.errors.length > 0 && lint.warnings.length > 0 && (
              <details className="text-text-muted">
                <summary className="cursor-pointer">{`${t.wsBpmnLintWarnings} (${lint.warnings.length})`}</summary>
                <ul className="mt-1 max-h-24 list-disc space-y-0.5 overflow-auto pl-4">
                  {lint.warnings.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              </details>
            )}
            {/* A save writes a new blueprint version; the PoC package stays as it was. */}
            {pocNoteLabel && (
              <p className="flex items-start gap-1.5 text-text-muted" data-testid="bpmn-saved-poc-note">
                <Icon name="info" size={13} className="mt-px" />
                <span>{pocNoteLabel}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
