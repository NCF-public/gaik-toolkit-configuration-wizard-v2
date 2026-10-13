/** Minimum zoom where 16px labels stay legible on typical laptop viewports. */
export const BPMN_READABLE_MIN_ZOOM = 0.72;

type CanvasLike = {
  zoom: (level?: number | string, center?: { x: number; y: number } | string) => number;
  viewbox: () => { inner: { x: number; y: number; width: number; height: number } };
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

/** Fit entire diagram into the viewport (overview). */
export function applyBpmnOverviewView(viewer: ViewerLike) {
  const canvas = viewer.get("canvas") as CanvasLike;
  canvas.zoom("fit-viewport", "auto");
}

/**
 * Prefer readable text: zoom in to BPMN_READABLE_MIN_ZOOM when fit-viewport
 * would shrink labels too far. User pans with NavigatedViewer + minimap.
 */
export function applyBpmnReadableView(viewer: ViewerLike) {
  const canvas = viewer.get("canvas") as CanvasLike;
  canvas.zoom("fit-viewport", "auto");
  const fitZoom = canvas.zoom();

  if (fitZoom >= BPMN_READABLE_MIN_ZOOM) {
    return;
  }

  canvas.zoom(BPMN_READABLE_MIN_ZOOM, focusCenter(viewer));
}
