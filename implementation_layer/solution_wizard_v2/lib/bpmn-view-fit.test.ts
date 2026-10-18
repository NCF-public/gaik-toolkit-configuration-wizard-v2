import { describe, expect, it, vi } from "vitest";
import {
  BPMN_MAX_ZOOM,
  BPMN_MIN_ZOOM,
  applyBpmnOverviewView,
  zoomBpmnAroundCenter,
} from "./bpmn-view-fit";

function fakeViewer(scale = 0.5) {
  const calls: string[] = [];
  const canvas = {
    resized: vi.fn(() => calls.push("resized")),
    zoom: vi.fn((level?: number | string, center?: unknown) => {
      if (level === undefined) return scale;
      calls.push(`zoom:${String(level)}:${JSON.stringify(center)}`);
      if (typeof level === "number") scale = level;
      return scale;
    }),
    viewbox: () => ({ inner: { x: 0, y: 0, width: 100, height: 100 } }),
  };
  return { viewer: { get: () => canvas }, canvas, calls };
}

describe("BPMN view fit and zoom", () => {
  it("refreshes the canvas size before fitting, so a grown container is fitted as it is now", () => {
    const { viewer, calls } = fakeViewer();
    applyBpmnOverviewView(viewer);
    expect(calls).toEqual(["resized", 'zoom:fit-viewport:"auto"']);
  });

  it("zooms around the middle of the visible area, not the corner", () => {
    const { viewer, calls } = fakeViewer(0.5);
    const scale = zoomBpmnAroundCenter(viewer, 1.25, { clientWidth: 676, clientHeight: 646 });
    expect(scale).toBeCloseTo(0.625);
    expect(calls).toEqual(["resized", 'zoom:0.625:{"x":338,"y":323}']);
  });

  it("keeps the toolbar's zoom limits", () => {
    expect(zoomBpmnAroundCenter(fakeViewer(3.9).viewer, 1.25, { clientWidth: 10, clientHeight: 10 })).toBe(
      BPMN_MAX_ZOOM,
    );
    expect(zoomBpmnAroundCenter(fakeViewer(0.21).viewer, 0.5, { clientWidth: 10, clientHeight: 10 })).toBe(
      BPMN_MIN_ZOOM,
    );
  });
});
