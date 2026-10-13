/** diagram-js scale 1.0 — only then show the minimap overlay. */
export const BPMN_NATIVE_ZOOM = 1;
const ZOOM_EPSILON = 0.02;

type CanvasLike = {
  zoom: () => number;
};

type MinimapLike = {
  close: () => void;
  isOpen: () => boolean;
};

type EventBusLike = {
  on: (event: string, fn: () => void) => void;
  off: (event: string, fn: () => void) => void;
};

type ViewerLike = {
  get: (name: string) => unknown;
};

export function isBpmnNativeZoom(zoom: number): boolean {
  return Math.abs(zoom - BPMN_NATIVE_ZOOM) < ZOOM_EPSILON;
}

/** Hide minimap unless the canvas is at 100% zoom; close it when zooming away. */
export function syncMinimapForZoom(viewer: ViewerLike, container: HTMLElement) {
  const canvas = viewer.get("canvas") as CanvasLike;
  const isNativeZoom = isBpmnNativeZoom(canvas.zoom());

  container.classList.toggle("bpmn-zoom-native", isNativeZoom);

  if (!isNativeZoom) {
    try {
      const minimap = viewer.get("minimap") as MinimapLike;
      if (minimap.isOpen()) {
        minimap.close();
      }
    } catch {
      /* minimap optional */
    }
  }
}

export function bindMinimapZoomSync(viewer: ViewerLike, container: HTMLElement) {
  const eventBus = viewer.get("eventBus") as EventBusLike;
  const onViewboxChanged = () => syncMinimapForZoom(viewer, container);

  eventBus.on("canvas.viewbox.changed", onViewboxChanged);
  syncMinimapForZoom(viewer, container);

  return () => eventBus.off("canvas.viewbox.changed", onViewboxChanged);
}
