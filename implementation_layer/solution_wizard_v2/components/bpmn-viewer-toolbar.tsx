"use client";

import type { BpmnViewerHandle } from "@/components/bpmn-viewer";
import type { BpmnModelerHandle } from "@/components/bpmn-modeler";
import { useState, type RefObject } from "react";

type BpmnZoomHandle = Pick<
  BpmnViewerHandle,
  "zoomIn" | "zoomOut" | "setViewMode" | "getViewMode"
> &
  Partial<Pick<BpmnViewerHandle, "getViewMode">>;

export function BpmnViewerToolbar({
  viewerRef,
  zoomInLabel,
  zoomOutLabel,
  overviewLabel,
  readableLabel,
  toolbarLabel,
}: {
  viewerRef: RefObject<BpmnZoomHandle | BpmnViewerHandle | BpmnModelerHandle | null>;
  zoomInLabel: string;
  zoomOutLabel: string;
  overviewLabel: string;
  readableLabel: string;
  toolbarLabel: string;
}) {
  const [viewMode, setViewMode] = useState<"readable" | "overview">("overview");

  function selectMode(mode: "readable" | "overview") {
    setViewMode(mode);
    viewerRef.current?.setViewMode(mode);
  }

  return (
    <div className="flex flex-nowrap items-center gap-2">
      <div
        className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-muted p-0.5"
        role="group"
        aria-label={toolbarLabel}
      >
        <button
          type="button"
          className={`bpmn-mode-btn ${viewMode === "readable" ? "bpmn-mode-btn-active" : ""}`}
          onClick={() => selectMode("readable")}
          aria-pressed={viewMode === "readable"}
        >
          {readableLabel}
        </button>
        <button
          type="button"
          className={`bpmn-mode-btn ${viewMode === "overview" ? "bpmn-mode-btn-active" : ""}`}
          onClick={() => selectMode("overview")}
          aria-pressed={viewMode === "overview"}
        >
          {overviewLabel}
        </button>
      </div>

      <div
        className="flex items-center gap-1 rounded-lg border border-border bg-surface-muted p-1"
        role="toolbar"
        aria-label={zoomInLabel}
      >
        <button
          type="button"
          className="bpmn-toolbar-btn"
          onClick={() => viewerRef.current?.zoomOut()}
          aria-label={zoomOutLabel}
          title={zoomOutLabel}
        >
          −
        </button>
        <button
          type="button"
          className="bpmn-toolbar-btn"
          onClick={() => viewerRef.current?.zoomIn()}
          aria-label={zoomInLabel}
          title={zoomInLabel}
        >
          +
        </button>
      </div>
    </div>
  );
}
