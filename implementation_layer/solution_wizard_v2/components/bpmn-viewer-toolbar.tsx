"use client";

import { Icon } from "@/components/icons";

/**
 * The diagram's view controls, one small group in the canvas's top-right
 * corner: zoom out, the zoom level, zoom in, and fit the whole diagram.
 * The view the diagram opens on is chosen by itself (lib/bpmn-view-fit).
 */
export function BpmnZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
  zoomInLabel,
  zoomOutLabel,
  fitLabel,
  groupLabel,
  className = "",
  testId = "bpmn-zoom",
}: {
  /** The canvas's scale (1 = 100 %); null until the diagram is drawn. */
  zoom: number | null;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  zoomInLabel: string;
  zoomOutLabel: string;
  fitLabel: string;
  groupLabel: string;
  className?: string;
  /** The simple flow view has the same controls under its own test ids. */
  testId?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label={groupLabel}
      className={`flex items-center gap-0.5 rounded-lg border border-border bg-surface/95 p-0.5 shadow-sm backdrop-blur-sm ${className}`}
      data-testid={`${testId}-controls`}
    >
      <button type="button" className="bpmn-toolbar-btn" onClick={onZoomOut} aria-label={zoomOutLabel} title={zoomOutLabel}>
        <Icon name="minus" size={16} />
      </button>
      <span
        className="min-w-[3.25rem] select-none text-center text-xs font-medium tabular-nums text-text-secondary"
        data-testid={`${testId}-level`}
      >
        {zoom == null ? "–" : `${Math.round(zoom * 100)} %`}
      </span>
      <button type="button" className="bpmn-toolbar-btn" onClick={onZoomIn} aria-label={zoomInLabel} title={zoomInLabel}>
        <Icon name="plus" size={16} />
      </button>
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
      <button type="button" className="bpmn-toolbar-btn" onClick={onFit} aria-label={fitLabel} title={fitLabel}>
        <Icon name="maximize" size={16} />
      </button>
    </div>
  );
}
