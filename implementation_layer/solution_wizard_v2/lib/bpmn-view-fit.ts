/** Minimum zoom where 16px labels stay legible on typical laptop viewports. */
export const BPMN_READABLE_MIN_ZOOM = 0.72;

/** Zoom limits of the toolbar's + and − buttons. */
export const BPMN_MIN_ZOOM = 0.2;
export const BPMN_MAX_ZOOM = 4;

type CanvasLike = {
  zoom: (level?: number | string, center?: { x: number; y: number } | string) => number;
  viewbox: () => { inner: { x: number; y: number; width: number; height: number } };
  resized?: () => void;
};

type ElementLike = {
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

type RegistryLike = {
  filter: (fn: (el: ElementLike) => boolean) => ElementLike[];
  get: (id: string) => ElementLike | undefined;
};

type ViewerLike = {
  get: (name: string) => unknown;
};

function focusCenter(viewer: ViewerLike): { x: number; y: number } {
  const registry = viewer.get("elementRegistry") as RegistryLike;
  const startEvents = registry.filter((el) => el.type === "bpmn:StartEvent");
  const participant = registry.get("Participant_main");
  const focus = startEvents[0] ?? participant;

  if (focus?.x != null && focus.width != null && focus.y != null && focus.height != null) {
    return { x: focus.x + focus.width / 2, y: focus.y + focus.height / 2 };
  }

  const { inner } = (viewer.get("canvas") as CanvasLike).viewbox();
  return { x: inner.x + inner.width * 0.15, y: inner.y + inner.height / 2 };
}

/**
 * Tell diagram-js the container may have changed size.
 *
 * The canvas caches its viewbox, outer size included, and fits and zooms
 * against that cache. A container that grew after the first fit (the tab
 * opening, the side panel settling) left the diagram fitted to the old size:
 * small, in a corner, partly outside the view, and every zoom then turned
 * around the old centre, pushing it further out.
 */
function refreshSize(canvas: CanvasLike) {
  canvas.resized?.();
}

/** Fit entire diagram into the viewport (overview). */
export function applyBpmnOverviewView(viewer: ViewerLike) {
  const canvas = viewer.get("canvas") as CanvasLike;
  refreshSize(canvas);
  canvas.zoom("fit-viewport", "auto");
}

/** Zoom by `factor` around the middle of what the user sees, within the toolbar's limits. */
export function zoomBpmnAroundCenter(
  viewer: ViewerLike,
  factor: number,
  container: { clientWidth: number; clientHeight: number },
): number {
  const canvas = viewer.get("canvas") as CanvasLike;
  refreshSize(canvas);
  const target = Math.min(BPMN_MAX_ZOOM, Math.max(BPMN_MIN_ZOOM, canvas.zoom() * factor));
  return canvas.zoom(target, { x: container.clientWidth / 2, y: container.clientHeight / 2 });
}

/**
 * Prefer readable text: zoom in to BPMN_READABLE_MIN_ZOOM when fit-viewport
 * would shrink labels too far. User pans with NavigatedViewer + minimap.
 */
export function applyBpmnReadableView(viewer: ViewerLike) {
  const canvas = viewer.get("canvas") as CanvasLike;
  refreshSize(canvas);
  canvas.zoom("fit-viewport", "auto");
  const fitZoom = canvas.zoom();

  if (fitZoom >= BPMN_READABLE_MIN_ZOOM) {
    return;
  }

  canvas.zoom(BPMN_READABLE_MIN_ZOOM, focusCenter(viewer));
}
