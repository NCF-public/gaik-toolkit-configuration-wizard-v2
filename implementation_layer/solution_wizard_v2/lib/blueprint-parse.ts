import type { Blueprint, BlueprintStepType } from "@/lib/mock-sessions";

const STEP_TYPES = new Set<BlueprintStepType>(["io", "ai", "human_review"]);

export function parseBlueprintJson(text: string): Blueprint | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.name !== "string" || !Array.isArray(obj.steps)) return null;

  const steps: Blueprint["steps"] = [];
  for (const raw of obj.steps) {
    if (!raw || typeof raw !== "object") return null;
    const step = raw as Record<string, unknown>;
    if (typeof step.id !== "string" || typeof step.name !== "string") return null;
    if (typeof step.type !== "string" || !STEP_TYPES.has(step.type as BlueprintStepType)) {
      return null;
    }
    steps.push({
      id: step.id,
      name: step.name,
      type: step.type as BlueprintStepType,
      ...(typeof step.component === "string" ? { component: step.component } : {}),
      ...(typeof step.description === "string" ? { description: step.description } : {}),
    });
  }

  return {
    name: obj.name,
    description: typeof obj.description === "string" ? obj.description : "",
    goal: typeof obj.goal === "string" ? obj.goal : "",
    steps,
    ...(obj.data_objects && typeof obj.data_objects === "object"
      ? { data_objects: obj.data_objects as Record<string, string> }
      : {}),
  };
}
