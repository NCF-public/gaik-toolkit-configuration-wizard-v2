"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  BpmnModeler,
  type BpmnModelerHandle,
  type BpmnSelectionInfo,
} from "@/components/bpmn-modeler";
import { BpmnViewerToolbar } from "@/components/bpmn-viewer-toolbar";
import { BpmnThemeSwitcher } from "@/components/bpmn-theme-switcher";
import { Icon } from "@/components/icons";
import {
  readBpmnCanvasTheme,
  type BpmnCanvasTheme,
} from "@/lib/bpmn-canvas-theme";
import type { Blueprint, BlueprintVersion } from "@/lib/mock-sessions";

export type BpmnSyncMeta = {
  activeVersion: number;
  versions: BlueprintVersion[];
};

export function BpmnDiagramPanel({
  sessionId,
  xml,
  activeVersion,
  ariaLabel,
  loadErrorLabel,
  dialogTitle,
  hintLabel,
  saveLabel,
  savingLabel,
  saveErrorLabel,
  savedLabel,
  undoLabel,
  undoingLabel,
  undoneLabel,
  undoErrorLabel,
  undoHintLabel,
  undoDisabledLabel,
  activeBlueprintLabel,
  lintBlockedLabel,
  lintWarningsLabel,
  zoomInLabel,
  zoomOutLabel,
  overviewLabel,
  readableLabel,
  toolbarLabel,
  themeLabel,
  themeLightLabel,
  themeDarkLabel,
  themeGaikLabel,
  propertiesTitle,
  propertiesName,
  propertiesType,
  propertiesCloseLabel,
  typeNames,
  pocNoteLabel,
  onSynced,
  onLocalStepNameChange,
}: {
  sessionId: string;
  xml: string;
  /** Omit until version history is wired up (no restore endpoint yet) — hides the Undo control. */
  activeVersion?: number;
  ariaLabel: string;
  loadErrorLabel: string;
  dialogTitle: string;
  hintLabel: string;
  saveLabel: string;
  savingLabel: string;
  saveErrorLabel: string;
  savedLabel: string;
  undoLabel?: string;
  undoingLabel?: string;
  undoneLabel?: string;
  undoErrorLabel?: string;
  undoHintLabel?: string;
  undoDisabledLabel?: string;
  activeBlueprintLabel: string;
  lintBlockedLabel: string;
  lintWarningsLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  overviewLabel: string;
  readableLabel: string;
  toolbarLabel: string;
  themeLabel: string;
  themeLightLabel: string;
  themeDarkLabel: string;
  themeGaikLabel: string;
  propertiesTitle: string;
  propertiesName: string;
  propertiesType: string;
  propertiesCloseLabel: string;
  /** Readable names for BPMN element types ("bpmn:Task" → "Tehtävä"). */
  typeNames: Record<string, string>;
  /** Shown while saved changes are not in the PoC package yet; the owner
   *  decides when (there is a package, and a save it does not have). */
  pocNoteLabel?: string | null;
  onSynced: (result: {
    blueprint: Blueprint;
    xml: string;
    meta?: BpmnSyncMeta;
    /** A save of the diagram, or an undo back to the version before. */
    via: "save" | "undo";
  }) => void;
  /**
   * Optimistic UI update while typing.
   * We still persist BPMN edits via "Tallenna → JSON".
   */
  onLocalStepNameChange?: (stepId: string, nextName: string) => void;
}) {
  const modelerRef = useRef<BpmnModelerHandle>(null);
  const titleId = useId();
  const propsTitleId = useId();
  // Match readBpmnCanvasTheme() SSR default; localStorage applied in useEffect.
  const [canvasTheme, setCanvasTheme] = useState<BpmnCanvasTheme>("gaik-v2");
  const [saving, setSaving] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [undoError, setUndoError] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [undoneFlash, setUndoneFlash] = useState(false);
  const [localActive, setLocalActive] = useState(activeVersion ?? 1);
  const [lintBlocked, setLintBlocked] = useState(false);
  const [lintMessages, setLintMessages] = useState<string[]>([]);
  const [lintWarnings, setLintWarnings] = useState<string[]>([]);
  const [selection, setSelection] = useState<BpmnSelectionInfo>(null);
  const [editName, setEditName] = useState("");
  const [propsClosed, setPropsClosed] = useState(false);

  useEffect(() => {
    setCanvasTheme(readBpmnCanvasTheme());
  }, []);

  useEffect(() => {
    if (typeof activeVersion === "number") setLocalActive(activeVersion);
  }, [activeVersion]);

  useEffect(() => {
    setEditName(selection?.name ?? "");
    setPropsClosed(false);
  }, [selection]);

  // Undo needs an active-version + restore endpoint the caller wires up;
  // without it the control stays hidden rather than erroring on click.
  const undoWired = typeof activeVersion === "number" && !!undoLabel;
  const canUndo = undoWired && localActive > 1;

  async function handleSave() {
    setSaving(true);
    setSaveError(false);
    setSavedFlash(false);
    setUndoError(false);
    setLintBlocked(false);
    setLintMessages([]);
    setLintWarnings([]);
    try {
      const editedXml = await modelerRef.current?.saveXml();
      if (!editedXml) throw new Error("no xml");
      const res = await fetch(`/api/sessions/${sessionId}/bpmn/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml: editedXml }),
      });
      const data = (await res.json().catch(() => null)) as {
        blueprint?: Blueprint;
        xml?: string;
        activeVersion?: number;
        versions?: BlueprintVersion[];
        lint?: {
          errors?: { rule: string; id: string; message: string }[];
          warnings?: { rule: string; id: string; message: string }[];
        };
        error?: string;
      } | null;

      if (res.status === 422 && data?.error === "bpmn_lint_failed") {
        setLintBlocked(true);
        setLintMessages(
          (data.lint?.errors ?? []).map(
            (e) => `${e.rule}${e.id ? ` (${e.id})` : ""}: ${e.message}`,
          ),
        );
        setLintWarnings(
          (data.lint?.warnings ?? []).map(
            (w) => `${w.rule}${w.id ? ` (${w.id})` : ""}: ${w.message}`,
          ),
        );
        return;
      }
      if (!res.ok || !data?.blueprint || !data.xml) throw new Error("sync failed");
      const warns = (data.lint?.warnings ?? []).map(
        (w) => `${w.rule}${w.id ? ` (${w.id})` : ""}: ${w.message}`,
      );
      setLintWarnings(warns);
      const nextActive =
        typeof data.activeVersion === "number"
          ? data.activeVersion
          : localActive + 1;
      setLocalActive(nextActive);
      onSynced({
        blueprint: data.blueprint,
        xml: data.xml,
        meta: {
          activeVersion: nextActive,
          versions: data.versions ?? [],
        },
        via: "save",
      });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  async function handleUndo() {
    if (!canUndo) return;
    const target = localActive - 1;
    setUndoing(true);
    setUndoError(false);
    setUndoneFlash(false);
    setSaveError(false);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/versions/${target}/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: "Undo last BPMN change" }),
        },
      );
      if (!res.ok) throw new Error("undo failed");
      const data = (await res.json()) as {
        blueprint: Blueprint;
        activeVersion: number;
        versions?: BlueprintVersion[];
      };

      const bpmnRes = await fetch(`/api/sessions/${sessionId}/bpmn`);
      if (!bpmnRes.ok) throw new Error("bpmn reload failed");
      const restoredXml = await bpmnRes.text();

      setLocalActive(data.activeVersion);
      onSynced({
        blueprint: data.blueprint,
        xml: restoredXml,
        meta: {
          activeVersion: data.activeVersion,
          versions: data.versions ?? [],
        },
        via: "undo",
      });
      setUndoneFlash(true);
      window.setTimeout(() => setUndoneFlash(false), 2500);
    } catch {
      setUndoError(true);
    } finally {
      setUndoing(false);
    }
  }

  function bpmnIdToStepId(bpmnId: string | undefined): string | null {
    if (!bpmnId) return null;
    if (bpmnId.startsWith("Activity_")) return bpmnId.slice("Activity_".length);
    if (bpmnId.startsWith("Gateway_")) return bpmnId.slice("Gateway_".length);
    return bpmnId;
  }

  function applyNameChange(next: string) {
    setEditName(next);
    modelerRef.current?.updateSelectedName(next);
    // Keep JSON tab in sync while typing (without waiting for save+sync).
    const stepId = bpmnIdToStepId(selection?.id);
    if (stepId && onLocalStepNameChange) {
      onLocalStepNameChange(stepId, next);
    }
  }

  // A selected element opens its properties over the canvas; with nothing
  // selected the canvas has the whole width. Closing hides them until the
  // next selection.
  const showProps = Boolean(selection) && !propsClosed;
  // The modeler reports the type with or without the "bpmn:" prefix.
  const typeName = (type: string) => {
    const bare = type.replace(/^bpmn:/, "");
    return typeNames[`bpmn:${bare}`] ?? bare;
  };

  return (
    <section className="flex w-full shrink-0 flex-col gap-3" aria-labelledby={titleId}>
      <h3 id={titleId} className="sr-only">
        {dialogTitle}
      </h3>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-brand shrink-0"
            onClick={handleSave}
            disabled={saving || undoing}
            data-testid="bpmn-save"
          >
            <Icon name={saving ? "loaderCircle" : "save"} size={16} className={saving ? "animate-spin" : ""} />
            {saving ? savingLabel : saveLabel}
          </button>
          {undoWired && (
            <button
              type="button"
              className="btn-ghost shrink-0"
              onClick={handleUndo}
              disabled={!canUndo || saving || undoing}
              data-testid="bpmn-undo"
              title={
                canUndo
                  ? undoHintLabel?.replace("{version}", String(localActive - 1))
                  : undoDisabledLabel
              }
            >
              {undoing ? undoingLabel : undoLabel}
            </button>
          )}
          {/* Only when the caller passes the version: a default of 1 said "v1"
              beside a page header that showed the real active version. */}
          {typeof activeVersion === "number" && (
            <span
              className="text-xs text-text-muted"
              data-testid="bpmn-version-label"
            >
              {activeBlueprintLabel} v{localActive}
            </span>
          )}
          {savedFlash && (
            <span className="badge-success text-xs">
              <Icon name="check" size={12} />
              {savedLabel}
            </span>
          )}
          {undoneFlash && (
            <span className="badge-success text-xs" data-testid="bpmn-undo-ok">
              {undoneLabel}
            </span>
          )}
          {saveError && (
            <span className="badge bg-danger-bg border-danger-border text-danger-text text-xs">
              {saveErrorLabel}
            </span>
          )}
          {undoError && (
            <span
              className="badge bg-danger-bg border-danger-border text-danger-text text-xs"
              data-testid="bpmn-undo-error"
            >
              {undoErrorLabel}
            </span>
          )}
          {lintBlocked && (
            <span className="badge bg-danger-bg border-danger-border text-danger-text text-xs">
              {lintBlockedLabel}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BpmnViewerToolbar
            viewerRef={modelerRef}
            zoomInLabel={zoomInLabel}
            zoomOutLabel={zoomOutLabel}
            overviewLabel={overviewLabel}
            readableLabel={readableLabel}
            toolbarLabel={toolbarLabel}
          />
          <BpmnThemeSwitcher
            theme={canvasTheme}
            onThemeChange={setCanvasTheme}
            label={themeLabel}
            lightLabel={themeLightLabel}
            darkLabel={themeDarkLabel}
            gaikLabel={themeGaikLabel}
          />
        </div>
      </div>
      <p className="max-w-3xl text-xs leading-relaxed text-text-muted">{hintLabel}</p>
      {/* A save writes a new blueprint version; the PoC package stays as it
          was until it is generated again. */}
      {pocNoteLabel && (
        <p
          role="status"
          className="flex max-w-3xl items-start gap-2 rounded-md border border-brand-soft-border bg-brand-soft px-3 py-2 text-xs text-brand-text"
          data-testid="bpmn-saved-poc-note"
        >
          <Icon name="info" size={14} className="mt-px" />
          <span>{pocNoteLabel}</span>
        </p>
      )}
      {lintMessages.length > 0 && (
        <ul
          className="max-w-3xl list-disc space-y-1 rounded-lg border border-danger-border bg-danger-bg/40 px-4 py-2 text-sm text-danger-text"
          role="alert"
        >
          {lintMessages.map((msg) => (
            <li key={msg}>{msg}</li>
          ))}
        </ul>
      )}
      {!lintBlocked && lintWarnings.length > 0 && (
        <div className="max-w-3xl space-y-1 rounded-lg border border-border bg-surface-muted px-4 py-2 text-sm text-text-secondary">
          <p className="font-medium text-text-strong">{lintWarningsLabel}</p>
          <ul className="list-disc space-y-1 pl-4">
            {lintWarnings.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      <div
        className={`relative h-[min(72vh,720px)] min-h-[480px] min-w-0 ${
          canvasTheme === "light" ? "rounded-lg bg-white" : "rounded-lg bg-app"
        }`}
      >
        <BpmnModeler
          ref={modelerRef}
          xml={xml}
          ariaLabel={ariaLabel}
          loadErrorLabel={loadErrorLabel}
          canvasTheme={canvasTheme}
          onSelectionChange={setSelection}
          className="h-full rounded-lg border border-border"
        />

        {showProps && selection && (
          <aside
            className="absolute right-3 top-3 z-10 w-64 max-w-[calc(100%-1.5rem)] rounded-lg border border-border bg-surface p-3 shadow-md"
            aria-labelledby={propsTitleId}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 id={propsTitleId} className="text-sm font-semibold text-text-strong">
                {propertiesTitle}
              </h4>
              <button
                type="button"
                className="icon-btn h-7 w-7"
                onClick={() => setPropsClosed(true)}
                aria-label={propertiesCloseLabel}
                title={propertiesCloseLabel}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-muted">{propertiesName}</span>
              <input
                type="text"
                className="input-field w-full text-sm"
                value={editName}
                onChange={(e) => applyNameChange(e.target.value)}
                data-testid="bpmn-property-name"
              />
            </label>
            <p className="mt-2 text-xs text-text-muted" title={selection.id}>
              {propertiesType}: <span className="text-text-secondary">{typeName(selection.type)}</span>
            </p>
          </aside>
        )}
      </div>
    </section>
  );
}
