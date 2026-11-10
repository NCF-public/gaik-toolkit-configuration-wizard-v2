"use client";

import {
  type BpmnCanvasTheme,
  writeBpmnCanvasTheme,
} from "@/lib/bpmn-canvas-theme";
import { Icon, type IconName } from "@/components/icons";

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

  const options: { id: BpmnCanvasTheme; title: string; icon: IconName }[] = [
    { id: "light", title: lightLabel, icon: "sun" },
    { id: "dark", title: darkLabel, icon: "contrast" },
    { id: "gaik-v2", title: gaikLabel, icon: "palette" },
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
          <Icon name={option.icon} size={15} />
          <span className="sr-only">{option.title}</span>
        </button>
      ))}
    </div>
  );
}
