"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  BpmnModeler,
  type BpmnModelerHandle,
  type BpmnSelectionInfo,
} from "@/components/bpmn-modeler";
import { BpmnViewerToolbar } from "@/components/bpmn-viewer-toolbar";
import { BpmnThemeSwitcher } from "@/components/bpmn-theme-switcher";
import {
  readBpmnCanvasTheme,
  type BpmnCanvasTheme,
} from "@/lib/bpmn-canvas-theme";
import type { Blueprint } from "@/lib/mock-sessions";

export function BpmnDiagramPanel({
  sessionId,
  xml,
  ariaLabel,
  loadErrorLabel,
  editableLabel,
  dialogTitle,
  hintLabel,
  saveLabel,
  savingLabel,
  saveErrorLabel,
  savedLabel,
  zoomInLabel,
  zoomOutLabel,
  overviewLabel,
  readableLabel,
  toolbarLabel,
  themeLabel,
  themeLightLabel,
  themeDarkLabel,
  themeGaikLabel,
  v2StartedLabel,
  propertiesTitle,
  propertiesEmpty,
  propertiesName,
  propertiesType,
  propertiesId,
  onSynced,
  onLocalStepNameChange,
}: {
  sessionId: string;
  xml: string;
  ariaLabel: string;
  loadErrorLabel: string;
  editableLabel: string;
  dialogTitle: string;
  hintLabel: string;
  saveLabel: string;
  savingLabel: string;
  saveErrorLabel: string;
  savedLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  overviewLabel: string;
  readableLabel: string;
  toolbarLabel: string;
  themeLabel: string;
  themeLightLabel: string;
  themeDarkLabel: string;
  themeGaikLabel: string;
  v2StartedLabel: string;
  propertiesTitle: string;
  propertiesEmpty: string;
  propertiesName: string;
  propertiesType: string;
  propertiesId: string;
  onSynced: (result: { blueprint: Blueprint; xml: string }) => void;
  /**
   * Optimistic UI update while typing.
   * We still persist BPMN edits via "Tallenna → JSON".
   */
  onLocalStepNameChange?: (stepId: string, nextName: string) => void;
}) {
  const modelerRef = useRef<BpmnModelerHandle>(null);
  const titleId = useId();
  const propsTitleId = useId();
  const [canvasTheme, setCanvasTheme] = useState<BpmnCanvasTheme>("light");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [selection, setSelection] = useState<BpmnSelectionInfo>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    setCanvasTheme(readBpmnCanvasTheme());
  }, []);

  useEffect(() => {
    setEditName(selection?.name ?? "");
  }, [selection]);

  async function handleSave() {
    setSaving(true);
    setSaveError(false);
    setSavedFlash(false);
    try {
      const editedXml = await modelerRef.current?.saveXml();
      if (!editedXml) throw new Error("no xml");
      const res = await fetch(`/api/sessions/${sessionId}/bpmn/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml: editedXml }),
      });
      if (!res.ok) throw new Error("sync failed");
      const data = (await res.json()) as { blueprint: Blueprint; xml: string };
      onSynced(data);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
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

  return (
    <section
      className="flex w-full shrink-0 flex-col gap-3 rounded-xl border border-border bg-surface/60 p-4 sm:p-5"
      aria-labelledby={titleId}
    >
      <div className="flex shrink-0 flex-col gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id={titleId}
              className="text-base font-semibold text-text-strong"
            >
              {dialogTitle}
            </h3>
            <span className="badge bg-brand-soft border border-brand-soft-border text-brand-text text-xs">
              BPMN 2.0
            </span>
            <span className="badge bg-surface-muted border border-border text-text-muted text-xs">
              {editableLabel}
            </span>
            <span className="badge bg-brand-soft border border-brand-soft-border text-brand-text text-xs">
              {v2StartedLabel}
            </span>
            {savedFlash && (
              <span className="badge-success text-xs">{savedLabel}</span>
            )}
            {saveError && (
              <span className="badge bg-danger-bg border-danger-border text-danger-text text-xs">
                {saveErrorLabel}
              </span>
            )}
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-text-secondary">
            {hintLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            type="button"
            className="btn-brand shrink-0"
            onClick={handleSave}
            disabled={saving}
            data-testid="bpmn-save"
          >
            {saving ? savingLabel : saveLabel}
          </button>
          <BpmnThemeSwitcher
            theme={canvasTheme}
            onThemeChange={setCanvasTheme}
            label={themeLabel}
            lightLabel={themeLightLabel}
            darkLabel={themeDarkLabel}
            gaikLabel={themeGaikLabel}
          />
          <BpmnViewerToolbar
            viewerRef={modelerRef}
            zoomInLabel={zoomInLabel}
            zoomOutLabel={zoomOutLabel}
            overviewLabel={overviewLabel}
            readableLabel={readableLabel}
            toolbarLabel={toolbarLabel}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-3 lg:flex-row">
        <div
          className={`relative min-h-[480px] h-[min(72vh,720px)] min-w-0 flex-1 ${
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
        </div>

        <aside
          className="flex w-full shrink-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 lg:w-72"
          aria-labelledby={propsTitleId}
        >
          <h4
            id={propsTitleId}
            className="text-sm font-semibold text-text-strong"
          >
            {propertiesTitle}
          </h4>
          {!selection ? (
            <p className="text-sm text-text-muted">{propertiesEmpty}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-text-muted">
                  {propertiesName}
                </span>
                <input
                  type="text"
                  className="input-field w-full text-sm"
                  value={editName}
                  onChange={(e) => applyNameChange(e.target.value)}
                  data-testid="bpmn-property-name"
                />
              </label>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-text-muted">
                  {propertiesType}
                </span>
                <span className="font-mono text-sm text-text-secondary">
                  {selection.type}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-text-muted">
                  {propertiesId}
                </span>
                <span className="break-all font-mono text-xs text-text-muted">
                  {selection.id}
                </span>
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
