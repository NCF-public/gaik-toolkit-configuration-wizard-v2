"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Blueprint, BlueprintStep, BlueprintStepType } from "@/lib/mock-sessions";
import { parseBlueprintJson } from "@/lib/blueprint-parse";
import type { Dict } from "@/lib/i18n";

const STEP_TYPES: BlueprintStepType[] = ["io", "ai", "human_review"];

// Reuse the workspace step color tokens so the form matches the flow view.
const STEP_ACCENT: Record<BlueprintStepType, string> = {
  io: "border-l-step-io",
  ai: "border-l-step-ai",
  human_review: "border-l-step-human",
};

function newStepId(existing: BlueprintStep[]): string {
  const ids = new Set(existing.map((s) => s.id));
  let candidate = "";
  do {
    candidate = `step_${Math.random().toString(36).slice(2, 8)}`;
  } while (ids.has(candidate));
  return candidate;
}

function settingsEntries(step: BlueprintStep): [string, string][] {
  return Object.entries(step.settings ?? {});
}

// Build a clean payload: trim strings, drop empty optional step fields, and
// preserve blueprint keys the form does not edit (data_objects, gateways,
// integration_targets) so a save never loses BPMN-synced data.
function toPayload(draft: Blueprint): Blueprint {
  return {
    ...draft,
    name: draft.name.trim(),
    description: draft.description?.trim() ?? "",
    goal: draft.goal?.trim() ?? "",
    steps: draft.steps.map((s) => {
      const cleanSettings = Object.fromEntries(
        settingsEntries(s)
          .map(([k, v]) => [k.trim(), v.trim()] as [string, string])
          .filter(([k]) => k.length > 0),
      );
      return {
        id: s.id,
        name: s.name.trim(),
        type: s.type,
        ...(s.component && s.component.trim()
          ? { component: s.component.trim() }
          : {}),
        ...(s.description && s.description.trim()
          ? { description: s.description.trim() }
          : {}),
        ...(Object.keys(cleanSettings).length ? { settings: cleanSettings } : {}),
      };
    }),
  };
}

export function BlueprintJsonEditor({
  sessionId,
  blueprint,
  onSaved,
  t,
}: {
  sessionId: string;
  blueprint: Blueprint;
  onSaved: (blueprint: Blueprint) => void;
  t: Dict;
}) {
  const [draft, setDraft] = useState<Blueprint>(() => structuredClone(blueprint));
  const [jsonText, setJsonText] = useState(() => JSON.stringify(blueprint, null, 2));
  const jsonFocused = useRef(false);
  const [saving, setSaving] = useState(false);
  const [parseError, setParseError] = useState(false);
  const [validationError, setValidationError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  // Step cards are collapsed by default; expand on demand or when just added.
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());
  const uid = useId();

  useEffect(() => {
    setDraft(structuredClone(blueprint));
    setJsonText(JSON.stringify(blueprint, null, 2));
    setOpenSteps(new Set());
    setParseError(false);
    setValidationError(false);
    setSaveError(false);
  }, [blueprint]);

  // Keep the raw JSON escape hatch in sync with form edits, unless the user
  // is actively typing in the textarea (avoids fighting the cursor).
  useEffect(() => {
    if (!jsonFocused.current) {
      setJsonText(JSON.stringify(draft, null, 2));
    }
  }, [draft]);

  const typeLabel: Record<BlueprintStepType, string> = {
    io: t.wsStepIo,
    ai: t.wsStepAi,
    human_review: t.wsStepHuman,
  };

  function patchDraft(next: Partial<Blueprint>) {
    setDraft((d) => ({ ...d, ...next }));
    setParseError(false);
    setValidationError(false);
    setSaveError(false);
  }

  function patchStep(index: number, patch: Partial<BlueprintStep>) {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
    setValidationError(false);
    setSaveError(false);
  }

  function addStep() {
    const id = newStepId(draft.steps);
    setDraft((d) => ({
      ...d,
      steps: [...d.steps, { id, name: "", type: "io" as BlueprintStepType }],
    }));
    setOpenSteps((prev) => new Set(prev).add(id));
    setValidationError(false);
  }

  function toggleStep(id: string) {
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function removeStep(index: number) {
    setDraft((d) => ({ ...d, steps: d.steps.filter((_, i) => i !== index) }));
    setValidationError(false);
  }

  function moveStep(index: number, dir: -1 | 1) {
    setDraft((d) => {
      const target = index + dir;
      if (target < 0 || target >= d.steps.length) return d;
      const steps = [...d.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...d, steps };
    });
  }

  // Component settings (SME-4 / Umair 14 Aug): key/value pairs per step.
  function addSetting(index: number) {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => {
        if (i !== index) return s;
        const entries = settingsEntries(s);
        let n = entries.length + 1;
        let key = `setting_${n}`;
        while (entries.some(([k]) => k === key)) key = `setting_${++n}`;
        return { ...s, settings: { ...s.settings, [key]: "" } };
      }),
    }));
  }

  function renameSettingKey(index: number, oldKey: string, newKey: string) {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => {
        if (i !== index || !s.settings) return s;
        if (newKey === oldKey) return s;
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(s.settings)) {
          next[k === oldKey ? newKey : k] = v;
        }
        return { ...s, settings: next };
      }),
    }));
  }

  function patchSettingValue(index: number, key: string, value: string) {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) =>
        i === index ? { ...s, settings: { ...s.settings, [key]: value } } : s,
      ),
    }));
  }

  function removeSetting(index: number, key: string) {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => {
        if (i !== index || !s.settings) return s;
        const next = { ...s.settings };
        delete next[key];
        return { ...s, settings: next };
      }),
    }));
  }

  function onJsonChange(value: string) {
    setJsonText(value);
    setSaveError(false);
    const parsed = parseBlueprintJson(value);
    if (parsed) {
      setParseError(false);
      setDraft(parsed);
    } else {
      setParseError(true);
    }
  }

  async function handleSave() {
    if (parseError) return;
    if (!draft.name.trim() || draft.steps.some((s) => !s.name.trim())) {
      setValidationError(true);
      setSaveError(false);
      return;
    }
    const payload = toPayload(draft);
    setSaving(true);
    setValidationError(false);
    setSaveError(false);
    setSavedFlash(false);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/blueprint`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: payload,
          note: "Blueprint päivitetty lomake-editorista",
        }),
      });
      if (!res.ok) throw new Error("save failed");
      const data = (await res.json()) as { blueprint: Blueprint };
      onSaved(data.blueprint);
      setDraft(structuredClone(data.blueprint));
      setJsonText(JSON.stringify(data.blueprint, null, 2));
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-brand shrink-0"
          onClick={handleSave}
          disabled={saving || parseError}
          data-testid="blueprint-save"
        >
          {saving ? t.wsJsonSaving : t.wsJsonSave}
        </button>
        {savedFlash && <span className="badge-success text-xs">{t.wsJsonSaved}</span>}
        {validationError && (
          <span className="badge bg-danger-bg border-danger-border text-danger-text text-xs">
            {t.wsFormInvalid}
          </span>
        )}
        {parseError && (
          <span className="badge bg-danger-bg border-danger-border text-danger-text text-xs">
            {t.wsJsonInvalid}
          </span>
        )}
        {saveError && (
          <span className="badge bg-danger-bg border-danger-border text-danger-text text-xs">
            {t.wsJsonSaveError}
          </span>
        )}
      </div>
      <p className="shrink-0 text-xs text-text-muted">{t.wsJsonHint}</p>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted/40 p-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-name`} className="text-xs font-medium text-text-strong">
              {t.wsFormName}
            </label>
            <input
              id={`${uid}-name`}
              type="text"
              className="input-field"
              value={draft.name}
              onChange={(e) => patchDraft({ name: e.target.value })}
              data-testid="blueprint-field-name"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-goal`} className="text-xs font-medium text-text-strong">
              {t.wsBlueprintGoal}
            </label>
            <textarea
              id={`${uid}-goal`}
              className="input-field min-h-[52px] resize-y"
              value={draft.goal ?? ""}
              onChange={(e) => patchDraft({ goal: e.target.value })}
              data-testid="blueprint-field-goal"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${uid}-description`}
              className="text-xs font-medium text-text-strong"
            >
              {t.wsFormDescription}
            </label>
            <textarea
              id={`${uid}-description`}
              className="input-field min-h-[72px] resize-y"
              value={draft.description ?? ""}
              onChange={(e) => patchDraft({ description: e.target.value })}
              data-testid="blueprint-field-description"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-text-strong">{t.wsFormSteps}</span>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={addStep}
              data-testid="blueprint-step-add"
            >
              + {t.wsFormAddStep}
            </button>
          </div>

          {draft.steps.length === 0 && (
            <p className="text-xs text-text-muted">{t.wsFormEmptySteps}</p>
          )}

          <ol className="flex flex-col gap-3">
            {draft.steps.map((step, index) => {
              const nameId = `${uid}-step-${index}-name`;
              const typeId = `${uid}-step-${index}-type`;
              const componentId = `${uid}-step-${index}-component`;
              const descriptionId = `${uid}-step-${index}-description`;
              const nameHintId = `${uid}-step-${index}-name-hint`;
              const bodyId = `${uid}-step-${index}-body`;
              const stepLabel = step.name.trim() || `${t.wsFormSteps} ${index + 1}`;
              const isOpen = openSteps.has(step.id);
              const settings = settingsEntries(step);
              return (
                <li
                  key={step.id}
                  className="rounded-lg border border-border bg-surface-muted/40 focus-within:border-brand/60"
                  aria-label={`${index + 1}. ${stepLabel}`}
                  data-testid={`blueprint-step-${index}`}
                >
                  <div className="flex items-center justify-between gap-2 p-3">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      aria-expanded={isOpen}
                      aria-controls={bodyId}
                      aria-label={`${isOpen ? t.wsFormCollapseStep : t.wsFormExpandStep} — ${stepLabel}`}
                      onClick={() => toggleStep(step.id)}
                      data-testid={`blueprint-step-${index}-toggle`}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-text-secondary bg-surface-muted border-l-2 ${STEP_ACCENT[step.type]}`}
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-strong">
                        {stepLabel}
                      </span>
                      <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-text-muted">
                        {typeLabel[step.type]}
                        {step.component ? ` · ${step.component}` : ""}
                        {settings.length ? ` · ${settings.length}⚙` : ""}
                      </span>
                      <span className="shrink-0 text-text-muted" aria-hidden="true">
                        {isOpen ? "▾" : "▸"}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className="btn-ghost px-2 text-xs"
                        onClick={() => moveStep(index, -1)}
                        disabled={index === 0}
                        aria-label={`${t.wsFormMoveUp} — ${stepLabel}`}
                        title={t.wsFormMoveUp}
                      >
                        <span aria-hidden="true">↑</span>
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-2 text-xs"
                        onClick={() => moveStep(index, 1)}
                        disabled={index === draft.steps.length - 1}
                        aria-label={`${t.wsFormMoveDown} — ${stepLabel}`}
                        title={t.wsFormMoveDown}
                      >
                        <span aria-hidden="true">↓</span>
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-2 text-xs text-danger-text"
                        onClick={() => removeStep(index)}
                        aria-label={`${t.wsFormRemoveStep} — ${stepLabel}`}
                        title={t.wsFormRemoveStep}
                        data-testid={`blueprint-step-${index}-remove`}
                      >
                        <span aria-hidden="true">✕</span>
                      </button>
                    </div>
                  </div>

                  <div
                    id={bodyId}
                    className={`${isOpen ? "flex" : "hidden"} flex-col gap-3 border-t border-border px-3 pb-3 pt-3`}
                  >
                    <div className="flex flex-col gap-1">
                      <label htmlFor={nameId} className="text-xs font-medium text-text-strong">
                        {t.wsFormName}
                      </label>
                      <input
                        id={nameId}
                        type="text"
                        className="input-field"
                        value={step.name}
                        aria-describedby={nameHintId}
                        onChange={(e) => patchStep(index, { name: e.target.value })}
                        data-testid={`blueprint-step-${index}-name`}
                      />
                      <p id={nameHintId} className="text-xs text-text-muted">
                        {t.wsFormNameHint}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="flex flex-col gap-1 sm:col-span-1">
                        <label
                          htmlFor={typeId}
                          className="text-xs font-medium text-text-strong"
                          title={t.wsFormTypeHint}
                        >
                          {t.wsFormStepType}
                        </label>
                        <select
                          id={typeId}
                          className="input-field"
                          value={step.type}
                          title={t.wsFormTypeHint}
                          onChange={(e) =>
                            patchStep(index, { type: e.target.value as BlueprintStepType })
                          }
                          data-testid={`blueprint-step-${index}-type`}
                        >
                          {STEP_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {typeLabel[type]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1 sm:col-span-2">
                        <label
                          htmlFor={componentId}
                          className="text-xs font-medium text-text-strong"
                          title={t.wsFormComponentHint}
                        >
                          {t.wsFormStepComponent}
                        </label>
                        <input
                          id={componentId}
                          type="text"
                          className="input-field"
                          value={step.component ?? ""}
                          placeholder={t.wsFormStepComponentNone}
                          title={t.wsFormComponentHint}
                          onChange={(e) => patchStep(index, { component: e.target.value })}
                          data-testid={`blueprint-step-${index}-component`}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={descriptionId}
                        className="text-xs font-medium text-text-strong"
                      >
                        {t.wsFormStepDescription}
                      </label>
                      <textarea
                        id={descriptionId}
                        className="input-field min-h-[48px] resize-y"
                        value={step.description ?? ""}
                        onChange={(e) => patchStep(index, { description: e.target.value })}
                        data-testid={`blueprint-step-${index}-description`}
                      />
                    </div>

                    <div className="flex flex-col gap-2 rounded-md border border-border/70 bg-surface p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-text-strong">
                          {t.wsFormStepSettings}
                        </span>
                        <button
                          type="button"
                          className="btn-ghost px-2 text-xs"
                          onClick={() => addSetting(index)}
                          data-testid={`blueprint-step-${index}-setting-add`}
                        >
                          + {t.wsFormSettingAdd}
                        </button>
                      </div>
                      <p className="text-xs text-text-muted">{t.wsFormSettingsHint}</p>
                      {settings.length === 0 ? (
                        <p className="text-xs text-text-muted">{t.wsFormSettingsEmpty}</p>
                      ) : (
                        <ul className="flex flex-col gap-1.5">
                          {settings.map(([key, value], settingIndex) => (
                            <li key={settingIndex} className="flex items-center gap-1.5">
                              <input
                                type="text"
                                className="input-field flex-1 text-xs"
                                defaultValue={key}
                                placeholder={t.wsFormSettingKeyPlaceholder}
                                aria-label={`${t.wsFormStepSettings} — key ${settingIndex + 1}`}
                                onBlur={(e) => renameSettingKey(index, key, e.target.value.trim() || key)}
                                data-testid={`blueprint-step-${index}-setting-${settingIndex}-key`}
                              />
                              <span className="text-text-muted" aria-hidden="true">
                                =
                              </span>
                              <input
                                type="text"
                                className="input-field flex-1 text-xs"
                                value={value}
                                placeholder={t.wsFormSettingValuePlaceholder}
                                aria-label={`${t.wsFormStepSettings} — value for ${key}`}
                                onChange={(e) => patchSettingValue(index, key, e.target.value)}
                                data-testid={`blueprint-step-${index}-setting-${settingIndex}-value`}
                              />
                              <button
                                type="button"
                                className="btn-ghost px-2 text-xs text-danger-text"
                                onClick={() => removeSetting(index, key)}
                                aria-label={`${t.wsFormSettingRemove} — ${key}`}
                                title={t.wsFormSettingRemove}
                                data-testid={`blueprint-step-${index}-setting-${settingIndex}-remove`}
                              >
                                <span aria-hidden="true">✕</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <details className="shrink-0 rounded-lg border border-border bg-surface-muted/40">
          <summary
            className="cursor-pointer px-3 py-2 text-sm font-medium text-text-secondary"
            data-testid="blueprint-json-toggle"
          >
            {t.wsFormDevJson}
          </summary>
          <div className="px-3 pb-3">
            <textarea
              className="input-field min-h-[280px] w-full font-mono text-xs leading-5 resize-y"
              value={jsonText}
              onFocus={() => {
                jsonFocused.current = true;
              }}
              onBlur={() => {
                jsonFocused.current = false;
                setJsonText(JSON.stringify(draft, null, 2));
              }}
              onChange={(e) => onJsonChange(e.target.value)}
              spellCheck={false}
              aria-label={t.wsFormDevJson}
              data-testid="blueprint-json-editor"
            />
          </div>
        </details>
      </div>
    </div>
  );
}
