"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type Modeler from "bpmn-js/lib/Modeler";
import type { BpmnCanvasTheme } from "@/lib/bpmn-canvas-theme";
import {
  applyBpmnOverviewView,
  applyBpmnReadableView,
} from "@/lib/bpmn-view-fit";
import { bindMinimapZoomSync } from "@/lib/bpmn-minimap-zoom";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";
import "diagram-js-minimap/assets/diagram-js-minimap.css";

type CanvasService = {
  zoom: (level?: number | string, center?: { x: number; y: number }) => number;
};

type EventBus = {
  on: (event: string, cb: (e: unknown) => void) => void;
  off: (event: string, cb: (e: unknown) => void) => void;
};

type Modeling = {
  updateProperties: (element: unknown, props: Record<string, unknown>) => void;
};

type Selection = {
  get: () => Array<{
    id: string;
    type: string;
    businessObject?: { id?: string; name?: string; $type?: string };
  }>;
};

export type BpmnSelectionInfo = {
  id: string;
  type: string;
  name: string;
} | null;

export type BpmnModelerHandle = {
  saveXml: () => Promise<string>;
  zoomIn: () => void;
  zoomOut: () => void;
  setViewMode: (mode: "readable" | "overview") => void;
  updateSelectedName: (name: string) => void;
};

function selectionFromModeler(modeler: Modeler): BpmnSelectionInfo {
  try {
    const selection = modeler.get("selection") as Selection;
    const selected = selection.get?.() ?? [];
    const el = selected[0];
    if (!el) return null;
    const bo = el.businessObject;
    const type = (bo?.$type || el.type || "").replace(/^bpmn:/, "");
    // Only surface flow nodes / data elements in the properties panel.
    const allowed = new Set([
      "UserTask",
      "ServiceTask",
      "Task",
      "ManualTask",
      "SendTask",
      "CallActivity",
      "StartEvent",
      "EndEvent",
      "ExclusiveGateway",
      "ParallelGateway",
      "DataObjectReference",
      "DataStoreReference",
    ]);
    if (!allowed.has(type)) return null;
    return {
      id: bo?.id || el.id,
      type,
      name: bo?.name || "",
    };
  } catch {
    return null;
  }
}

export const BpmnModeler = forwardRef<
  BpmnModelerHandle,
  {
    xml: string;
    ariaLabel: string;
    loadErrorLabel: string;
    className?: string;
    canvasTheme?: BpmnCanvasTheme;
    onSelectionChange?: (info: BpmnSelectionInfo) => void;
  }
>(function BpmnModeler(
  {
    xml,
    ariaLabel,
    loadErrorLabel,
    className = "",
    canvasTheme = "light",
    onSelectionChange,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<Modeler | null>(null);
  const onSelectionRef = useRef(onSelectionChange);
  onSelectionRef.current = onSelectionChange;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const zoomBy = useCallback((factor: number) => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    try {
      const canvas = modeler.get("canvas") as CanvasService;
      const current = canvas.zoom();
      canvas.zoom(Math.min(4, Math.max(0.2, current * factor)));
    } catch {
      /* tearing down */
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      saveXml: async () => {
        const modeler = modelerRef.current;
        if (!modeler) throw new Error("modeler not ready");
        const { xml: saved } = await modeler.saveXML({ format: true });
        if (!saved) throw new Error("empty BPMN XML");
        return saved;
      },
      zoomIn: () => zoomBy(1.25),
      zoomOut: () => zoomBy(1 / 1.25),
      setViewMode: (mode) => {
        const modeler = modelerRef.current;
        if (!modeler) return;
        if (mode === "overview") applyBpmnOverviewView(modeler);
        else applyBpmnReadableView(modeler);
      },
      updateSelectedName: (name: string) => {
        const modeler = modelerRef.current;
        if (!modeler) return;
        try {
          const selection = modeler.get("selection") as Selection;
          const el = selection.get?.()[0];
          if (!el) return;
          const modeling = modeler.get("modeling") as Modeling;
          modeling.updateProperties(el, { name });
          onSelectionRef.current?.(selectionFromModeler(modeler));
        } catch {
          /* ignore */
        }
      },
    }),
    [zoomBy],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    setReady(false);
    setError(null);
    let unbindMinimapZoom: (() => void) | undefined;
    let onSelection: ((e: unknown) => void) | undefined;

    (async () => {
      modelerRef.current?.destroy();
      modelerRef.current = null;

      const [{ default: BpmnModelerCtor }, { default: minimapModule }] =
        await Promise.all([
          import("bpmn-js/lib/Modeler"),
          import("diagram-js-minimap"),
        ]);
      if (cancelled) return;

      const modeler = new BpmnModelerCtor({
        container,
        additionalModules: [minimapModule],
      });
      modelerRef.current = modeler;

      try {
        await modeler.importXML(xml);
        if (cancelled) return;
        applyBpmnOverviewView(modeler);
        try {
          unbindMinimapZoom = bindMinimapZoomSync(modeler, container);
        } catch {
          /* optional */
        }

        const eventBus = modeler.get("eventBus") as EventBus;
        onSelection = () => {
          onSelectionRef.current?.(selectionFromModeler(modeler));
        };
        eventBus.on("selection.changed", onSelection);
        onSelectionRef.current?.(null);

        setReady(true);
      } catch (err) {
        console.error("[BpmnModeler] import failed:", err);
        if (!cancelled) setError(loadErrorLabel);
      }
    })();

    return () => {
      cancelled = true;
      unbindMinimapZoom?.();
      const modeler = modelerRef.current;
      if (modeler && onSelection) {
        try {
          (modeler.get("eventBus") as EventBus).off(
            "selection.changed",
            onSelection,
          );
        } catch {
          /* tearing down */
        }
      }
      setReady(false);
      modelerRef.current?.destroy();
      modelerRef.current = null;
    };
  }, [xml, loadErrorLabel]);

  useEffect(() => {
    if (!ready) return;
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const modeler = modelerRef.current;
      if (!modeler) return;
      try {
        applyBpmnOverviewView(modeler);
      } catch {
        /* tearing down */
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [ready]);

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
      className={`bpmn-viewer-themed h-full min-h-[480px] overflow-hidden [&_.bjs-powered-by]:hidden ${className}`}
      role="application"
      aria-label={ariaLabel}
      aria-busy={!ready}
    />
  );
});
