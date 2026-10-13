"use client";

import { useEffect, useState } from "react";
import type { Blueprint } from "@/lib/mock-sessions";
import { parseBlueprintJson } from "@/lib/blueprint-parse";
import type { Dict } from "@/lib/i18n";

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
  const [text, setText] = useState(() => JSON.stringify(blueprint, null, 2));
  const [saving, setSaving] = useState(false);
  const [parseError, setParseError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setText(JSON.stringify(blueprint, null, 2));
    setParseError(false);
    setSaveError(false);
  }, [blueprint]);

  async function handleSave() {
    const parsed = parseBlueprintJson(text);
    if (!parsed) {
      setParseError(true);
      setSaveError(false);
      return;
    }
    setSaving(true);
    setParseError(false);
    setSaveError(false);
    setSavedFlash(false);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/blueprint`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: parsed,
          note: "Blueprint päivitetty JSON-editorista",
        }),
      });
      if (!res.ok) throw new Error("save failed");
      const data = (await res.json()) as { blueprint: Blueprint };
      onSaved(data.blueprint);
      setText(JSON.stringify(data.blueprint, null, 2));
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
          disabled={saving}
          data-testid="blueprint-save"
        >
          {saving ? t.wsJsonSaving : t.wsJsonSave}
        </button>
        {savedFlash && <span className="badge-success text-xs">{t.wsJsonSaved}</span>}
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
      <textarea
        className="input-field min-h-[420px] flex-1 font-mono text-xs leading-5 resize-y"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setParseError(false);
          setSaveError(false);
        }}
        spellCheck={false}
        aria-label={t.wsTabJson}
        data-testid="blueprint-json-editor"
      />
    </div>
  );
}
