"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type NavigatedViewer from "bpmn-js/lib/NavigatedViewer";
import type { BpmnCanvasTheme } from "@/lib/bpmn-canvas-theme";
import {
  applyBpmnOverviewView,
  applyBpmnReadableView,
} from "@/lib/bpmn-view-fit";
import { bindMinimapZoomSync } from "@/lib/bpmn-minimap-zoom";
import { BPMN_VIEWER_OPTIONS } from "@/lib/bpmn-viewer-options";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "diagram-js-minimap/assets/diagram-js-minimap.css";

type CanvasService = {
  zoom: (level?: number | string, center?: { x: number; y: number }) => number;
};

export type BpmnViewMode = "readable" | "overview";

export type BpmnViewerHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  setViewMode: (mode: BpmnViewMode) => void;
  getViewMode: () => BpmnViewMode;
};

export type BpmnRendererMode = "standard" | "gaik";

export const BpmnViewer = forwardRef<
  BpmnViewerHandle,
  {
    xml: string;
    ariaLabel: string;
    loadErrorLabel: string;
    className?: string;
    initialViewMode?: BpmnViewMode;
    canvasTheme?: BpmnCanvasTheme;
    /** standard = native bpmn-js shapes (official BPMN 2.0); gaik = custom GAIK renderer */
    rendererMode?: BpmnRendererMode;
  }
>(function BpmnViewer(
  {
    xml,
    ariaLabel,
    loadErrorLabel,
    className = "",
    initialViewMode = "readable",
    canvasTheme = "gaik-v2",
    rendererMode = "standard",
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<NavigatedViewer | null>(null);
  const viewModeRef = useRef<BpmnViewMode>(initialViewMode);
  const userZoomedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const applyViewMode = useCallback((mode: BpmnViewMode) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewModeRef.current = mode;
    try {
      if (mode === "overview") {
        applyBpmnOverviewView(viewer);
      } else {
        applyBpmnReadableView(viewer);
      }
    } catch {
      /* viewer tearing down */
    }
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    userZoomedRef.current = true;
    viewModeRef.current = "readable";
    try {
      const canvas = viewer.get("canvas") as CanvasService;
      const current = canvas.zoom();
      canvas.zoom(Math.min(4, Math.max(0.2, current * factor)));
    } catch {
      /* viewer tearing down */
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomBy(1.25),
      zoomOut: () => zoomBy(1 / 1.25),
      setViewMode: (mode: BpmnViewMode) => {
        userZoomedRef.current = false;
        applyViewMode(mode);
      },
      getViewMode: () => viewModeRef.current,
    }),
    [applyViewMode, zoomBy],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    setReady(false);
    setError(null);
    userZoomedRef.current = false;
    viewModeRef.current = initialViewMode;

    let unbindMinimapZoom: (() => void) | undefined;

    (async () => {
      viewerRef.current?.destroy();
      viewerRef.current = null;

      const [{ default: Viewer }, { default: minimapModule }] = await Promise.all([
        import("bpmn-js/lib/NavigatedViewer"),
        import("diagram-js-minimap"),
      ]);
      if (cancelled) return;

      type ViewerModule = NonNullable<
        ConstructorParameters<typeof Viewer>[0]
      >["additionalModules"] extends (infer M)[] | undefined
        ? M
        : never;

      const additionalModules: ViewerModule[] = [minimapModule as ViewerModule];
      let viewerOptions: Record<string, unknown> = {};

      if (rendererMode === "gaik") {
        const [customRendererModule, diagramEnrichmentModule] = await Promise.all([
          import("@/lib/bpmn/custom-renderer.module"),
          import("@/lib/bpmn/diagram-enrichment.module"),
        ]);
        if (cancelled) return;
        additionalModules.push(
          customRendererModule.default as ViewerModule,
          diagramEnrichmentModule.default as ViewerModule,
        );
        viewerOptions = { ...BPMN_VIEWER_OPTIONS };
      }

      const viewer = new Viewer({
        container,
        additionalModules,
        ...viewerOptions,
      });
      viewerRef.current = viewer;

      try {
        await viewer.importXML(xml);
        if (cancelled) return;

        applyViewMode(initialViewMode);

        try {
          unbindMinimapZoom = bindMinimapZoomSync(viewer, container);
        } catch {
          /* minimap optional */
        }

        setReady(true);
      } catch (err) {
        console.error("[BpmnViewer] import failed:", err);
        if (!cancelled) setError(loadErrorLabel);
      }
    })();

    return () => {
      cancelled = true;
      unbindMinimapZoom?.();
      setReady(false);
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [xml, loadErrorLabel, initialViewMode, applyViewMode, rendererMode]);

  useEffect(() => {
    if (!ready) return;
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      if (userZoomedRef.current) return;
      applyViewMode(viewModeRef.current);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [ready, applyViewMode]);

  if (error) {
    return (
      <p className="text-sm text-danger-text" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div
      ref={containerRef}
      data-bpmn-theme={canvasTheme}
      className={`bpmn-viewer-themed h-full min-h-[280px] overflow-hidden [&_.bjs-powered-by]:hidden ${className}`}
      role="img"
      aria-label={ariaLabel}
      aria-busy={!ready}
    />
  );
});
