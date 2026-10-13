import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BPMN_CANVAS_THEME_STORAGE_KEY,
  readBpmnCanvasTheme,
  writeBpmnCanvasTheme,
} from "@/lib/bpmn-canvas-theme";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readBpmnCanvasTheme", () => {
  it("defaults to gaik-v2 during SSR (no window)", () => {
    expect(readBpmnCanvasTheme()).toBe("gaik-v2");
  });

  it("reads a valid stored theme in the browser", () => {
    const store = new Map<string, string>([[BPMN_CANVAS_THEME_STORAGE_KEY, "dark"]]);
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null });
    expect(readBpmnCanvasTheme()).toBe("dark");
  });

  it("falls back to gaik-v2 for an unrecognised stored value", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", { getItem: () => "not-a-theme" });
    expect(readBpmnCanvasTheme()).toBe("gaik-v2");
  });

  it("falls back to gaik-v2 when nothing is stored", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", { getItem: () => null });
    expect(readBpmnCanvasTheme()).toBe("gaik-v2");
  });
});

describe("writeBpmnCanvasTheme", () => {
  it("persists the theme under the shared storage key", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    writeBpmnCanvasTheme("light");
    expect(setItem).toHaveBeenCalledWith(BPMN_CANVAS_THEME_STORAGE_KEY, "light");
  });
});
