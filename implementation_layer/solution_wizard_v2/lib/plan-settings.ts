/**
 * The step settings the Plan tab shows: the readable ones. A value holding
 * JSON (a constructor's options, say `transcriber_ctor`) is configuration for
 * the Blueprint tab, not something an approver reads, and an empty one says
 * nothing.
 */
export function readableSettings(settings: Record<string, string> | undefined): [string, string][] {
  return Object.entries(settings ?? {}).filter(([, value]) => {
    const v = value.trim();
    return v !== "" && !v.startsWith("{") && !v.startsWith("[");
  });
}
