"use client";

import { Icon } from "@/components/icons";

/**
 * The diagram's view controls, one small group in the canvas's top-right
 * corner: zoom out, the zoom level, zoom in, and the diagram at the size of
 * the window. A press on the level fits the whole diagram, so the corner
 * button is free to do what its place promises: make the diagram large.
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
  expanded = false,
  onToggleExpanded,
  expandLabel,
  collapseLabel,
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
  /** The diagram fills the window (the Workflow tab owns that). */
  expanded?: boolean;
  onToggleExpanded?: () => void;
  expandLabel?: string;
  collapseLabel?: string;
  className?: string;
  /** The simple flow view has the same controls under its own test ids. */
  testId?: string;
}) {
  const level = zoom == null ? "–" : `${Math.round(zoom * 100)} %`;
  const sizeLabel = expanded ? collapseLabel : expandLabel;
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
      <button
        type="button"
        className="bpmn-toolbar-btn min-w-[3.25rem] select-none px-1 text-xs font-medium tabular-nums"
        onClick={onFit}
        aria-label={zoom == null ? fitLabel : `${fitLabel}, ${level}`}
        title={fitLabel}
        data-testid={`${testId}-level`}
      >
        {level}
      </button>
      <button type="button" className="bpmn-toolbar-btn" onClick={onZoomIn} aria-label={zoomInLabel} title={zoomInLabel}>
        <Icon name="plus" size={16} />
      </button>
      {onToggleExpanded && sizeLabel && (
        <>
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
          <button
            type="button"
            className="bpmn-toolbar-btn"
            onClick={onToggleExpanded}
            aria-pressed={expanded}
            aria-label={sizeLabel}
            title={sizeLabel}
            data-diagram-expand
            data-testid={`${testId}-expand`}
          >
            <Icon name={expanded ? "minimize2" : "maximize2"} size={16} />
          </button>
        </>
      )}
    </div>
  );
}
