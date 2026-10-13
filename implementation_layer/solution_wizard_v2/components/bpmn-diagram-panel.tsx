"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BpmnViewer, type BpmnViewerHandle } from "@/components/bpmn-viewer";
import { BpmnViewerToolbar } from "@/components/bpmn-viewer-toolbar";
import { BpmnThemeSwitcher } from "@/components/bpmn-theme-switcher";
import {
  readBpmnCanvasTheme,
  type BpmnCanvasTheme,
} from "@/lib/bpmn-canvas-theme";

export function BpmnDiagramPanel({
  xml,
  ariaLabel,
  loadErrorLabel,
  readOnlyLabel,
  openLabel,
  closeLabel,
  dialogTitle,
  hintLabel,
  zoomInLabel,
  zoomOutLabel,
  overviewLabel,
  readableLabel,
  toolbarLabel,
  themeLabel,
  themeLightLabel,
  themeDarkLabel,
  themeGaikLabel,
}: {
  xml: string;
  ariaLabel: string;
  loadErrorLabel: string;
  readOnlyLabel: string;
  openLabel: string;
  closeLabel: string;
  dialogTitle: string;
  hintLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  overviewLabel: string;
  readableLabel: string;
  toolbarLabel: string;
  themeLabel: string;
  themeLightLabel: string;
  themeDarkLabel: string;
  themeGaikLabel: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewerRef = useRef<BpmnViewerHandle>(null);
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [canvasTheme, setCanvasTheme] = useState<BpmnCanvasTheme>("gaik-v2");

  useEffect(() => {
    setMounted(true);
    setCanvasTheme(readBpmnCanvasTheme());
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      document.body.style.overflow = "";
      setDialogOpen(false);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [mounted]);

  useEffect(() => {
    if (!dialogOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeDialog();
        return;
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        viewerRef.current?.zoomIn();
      }
      if (e.key === "-") {
        e.preventDefault();
        viewerRef.current?.zoomOut();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen]);

  function openDialog() {
    const dialog = dialogRef.current;
    if (!dialog) return;
    document.body.style.overflow = "hidden";
    setDialogOpen(true);
    dialog.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <>
      <section
        className="shrink-0 rounded-xl border border-border bg-surface/60 p-4 sm:p-5"
        aria-labelledby={`${titleId}-card`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                id={`${titleId}-card`}
                className="text-base font-semibold text-text-strong"
              >
                {dialogTitle}
              </h3>
              <span className="badge bg-brand-soft border border-brand-soft-border text-brand-text text-xs">
                BPMN 2.0
              </span>
              <span className="badge bg-surface-muted border border-border text-text-muted text-xs">
                {readOnlyLabel}
              </span>
            </div>
            <p className="text-sm text-text-secondary leading-relaxed">{hintLabel}</p>
          </div>
          <button
            type="button"
            className="btn-primary shrink-0 self-start sm:self-center"
            onClick={openDialog}
          >
            {openLabel}
          </button>
        </div>
      </section>

      {mounted &&
        createPortal(
          <dialog
            ref={dialogRef}
            aria-labelledby={titleId}
            className="bpmn-dialog fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0"
            onCancel={(e) => {
              e.preventDefault();
              closeDialog();
            }}
          >
            <div className="flex h-full w-full flex-col bg-surface">
              <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
                <h2
                  id={titleId}
                  className="min-w-0 truncate text-lg font-semibold tracking-tight text-text-strong"
                >
                  {dialogTitle}
                </h2>
                <div className="flex shrink-0 flex-nowrap items-center gap-2 sm:gap-3">
                  <BpmnThemeSwitcher
                    theme={canvasTheme}
                    onThemeChange={setCanvasTheme}
                    label={themeLabel}
                    lightLabel={themeLightLabel}
                    darkLabel={themeDarkLabel}
                    gaikLabel={themeGaikLabel}
                  />
                  <BpmnViewerToolbar
                    viewerRef={viewerRef}
                    zoomInLabel={zoomInLabel}
                    zoomOutLabel={zoomOutLabel}
                    overviewLabel={overviewLabel}
                    readableLabel={readableLabel}
                    toolbarLabel={toolbarLabel}
                  />
                  <button type="button" className="btn-secondary" onClick={closeDialog}>
                    {closeLabel}
                  </button>
                </div>
              </header>
              <div
                className={`relative min-h-0 flex-1 ${
                  canvasTheme === "light" ? "bg-white" : "bg-app"
                }`}
              >
                {dialogOpen && (
                  <BpmnViewer
                    ref={viewerRef}
                    xml={xml}
                    ariaLabel={ariaLabel}
                    loadErrorLabel={loadErrorLabel}
                    initialViewMode="readable"
                    canvasTheme={canvasTheme}
                    className="h-full min-h-0 rounded-none border-0"
                  />
                )}
              </div>
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
