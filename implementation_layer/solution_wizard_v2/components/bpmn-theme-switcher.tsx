"use client";

import {
  type BpmnCanvasTheme,
  writeBpmnCanvasTheme,
} from "@/lib/bpmn-canvas-theme";

export function BpmnThemeSwitcher({
  theme,
  onThemeChange,
  label,
  lightLabel,
  darkLabel,
  gaikLabel,
}: {
  theme: BpmnCanvasTheme;
  onThemeChange: (theme: BpmnCanvasTheme) => void;
  label: string;
  lightLabel: string;
  darkLabel: string;
  gaikLabel: string;
}) {
  function select(next: BpmnCanvasTheme) {
    writeBpmnCanvasTheme(next);
    onThemeChange(next);
  }

  const options: { id: BpmnCanvasTheme; title: string; glyph: string }[] = [
    { id: "light", title: lightLabel, glyph: "☀" },
    { id: "dark", title: darkLabel, glyph: "◐" },
    { id: "gaik-v2", title: gaikLabel, glyph: "G" },
  ];

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-muted p-0.5"
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`bpmn-theme-btn ${theme === option.id ? "bpmn-theme-btn-active" : ""} ${
            option.id === "gaik-v2" ? "bpmn-theme-btn-gaik" : ""
          }`}
          onClick={() => select(option.id)}
          aria-pressed={theme === option.id}
          title={option.title}
        >
          <span className="bpmn-theme-btn__glyph" aria-hidden="true">
            {option.glyph}
          </span>
          <span className="sr-only">{option.title}</span>
        </button>
      ))}
    </div>
  );
}
