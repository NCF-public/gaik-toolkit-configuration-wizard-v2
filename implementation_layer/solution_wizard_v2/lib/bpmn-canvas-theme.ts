export type BpmnCanvasTheme = "light" | "dark" | "gaik-v2";

export const BPMN_CANVAS_THEME_STORAGE_KEY = "solution-wizard-bpmn-canvas-theme";

export const BPMN_CANVAS_THEMES: BpmnCanvasTheme[] = ["light", "dark", "gaik-v2"];

export function readBpmnCanvasTheme(): BpmnCanvasTheme {
  if (typeof window === "undefined") return "gaik-v2";
  const stored = localStorage.getItem(BPMN_CANVAS_THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "gaik-v2") {
    return stored;
  }
  return "gaik-v2";
}

export function writeBpmnCanvasTheme(theme: BpmnCanvasTheme): void {
  localStorage.setItem(BPMN_CANVAS_THEME_STORAGE_KEY, theme);
}
