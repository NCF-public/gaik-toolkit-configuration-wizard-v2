import type { Blueprint, BlueprintStep } from "@/lib/mock-sessions";

/**
 * The Blueprint form's draft: what it sends when it saves, and when it may
 * save. The form saves by itself, so "is there something to save" and "may it
 * be saved" are decided here, on the content a save would write.
 */

/** How long the form waits after the last edit before it saves by itself. */
export const BLUEPRINT_AUTOSAVE_DELAY_MS = 1200;

function settingsEntries(step: BlueprintStep): [string, string][] {
  return Object.entries(step.settings ?? {});
}

/**
 * The blueprint a save writes: strings trimmed, empty optional step fields
 * left out, and the keys the form does not edit (data_objects, gateways,
 * integration_targets) kept, so a save never loses what the diagram synced.
 * The keys come in one order, so two drafts with the same content compare equal.
 */
export function blueprintPayload(draft: Blueprint): Blueprint {
  const { name, description, goal, steps, ...rest } = draft;
  const kept = Object.fromEntries(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b)));
  return {
    name: name.trim(),
    description: description?.trim() ?? "",
    goal: goal?.trim() ?? "",
    steps: steps.map((s) => {
      const settings = Object.fromEntries(
        settingsEntries(s)
          .map(([k, v]) => [k.trim(), v.trim()] as [string, string])
          .filter(([k]) => k.length > 0),
      );
      return {
        id: s.id,
        name: s.name.trim(),
        type: s.type,
        ...(s.component && s.component.trim() ? { component: s.component.trim() } : {}),
        ...(s.description && s.description.trim() ? { description: s.description.trim() } : {}),
        ...(Object.keys(settings).length ? { settings } : {}),
      };
    }),
    ...kept,
  };
}

/** The saved content as a comparable key: equal keys mean a save would change nothing. */
export function blueprintPayloadKey(draft: Blueprint): string {
  return JSON.stringify(blueprintPayload(draft));
}

export type BlueprintDraftProblem = "name" | "stepName";

/** Why a draft is not saved yet: the blueprint or one of its steps has no name. */
export function blueprintDraftProblem(draft: Blueprint): BlueprintDraftProblem | null {
  if (draft.steps.some((s) => !s.name.trim())) return "stepName";
  if (!draft.name.trim()) return "name";
  return null;
}

/** A removed step back at its place ("Kumoa"); at the end when the list got shorter meanwhile. */
export function restoreStep(steps: BlueprintStep[], step: BlueprintStep, index: number): BlueprintStep[] {
  if (steps.some((s) => s.id === step.id)) return steps;
  const at = Math.min(Math.max(index, 0), steps.length);
  return [...steps.slice(0, at), step, ...steps.slice(at)];
}
