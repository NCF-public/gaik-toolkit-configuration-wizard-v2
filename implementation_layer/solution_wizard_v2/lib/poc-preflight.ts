/**
 * The preflight of a generated package (#252): a sandbox Job that imports what
 * run_poc.py imports, builds each stage's model config and loads the approved
 * schema, with no model call and no input. wizard_api runs it; this file decides
 * when the tab asks for one and how its log reads.
 */

export type PreflightPhase = "idle" | "running" | "ok" | "failed";

export type PreflightState = {
  phase: PreflightPhase;
  /** The package version the check looked at. */
  version: string | null;
  /** What the check found wrong, one line each. */
  problems: string[];
};

export const NO_PREFLIGHT: PreflightState = { phase: "idle", version: null, problems: [] };

/**
 * Ask for a preflight when the package is ready and the version in front of us
 * is not one already checked (or being checked). The agent rewrites run_poc.py
 * after a package first reads as ready, so a package that merely exists is not
 * a package that was checked.
 */
export function shouldStartPreflight(input: {
  onPocTab: boolean;
  ready: boolean;
  version: string | null;
  checkedVersion: string | null;
}): boolean {
  return input.onPocTab && input.ready && input.version !== null && input.version !== input.checkedVersion;
}

/** The problems a preflight log names ("PROBLEM: ..." lines), without the prefix. */
export function preflightProblems(lines: string[]): string[] {
  return lines
    .filter((l) => l.startsWith("PROBLEM: "))
    .map((l) => l.slice("PROBLEM: ".length).trim())
    .filter(Boolean);
}

/**
 * The outcome of a finished preflight. The Job's phase decides pass or fail; the
 * log supplies the reasons, and a failed Job with no PROBLEM line (the check
 * script itself did not start, or the Job hit its limit) still says it failed.
 */
export function preflightOutcome(
  phase: string,
  lines: string[],
  message?: string | null,
): { phase: "ok" | "failed"; problems: string[] } {
  const problems = preflightProblems(lines);
  if (phase === "succeeded" && problems.length === 0) return { phase: "ok", problems: [] };
  if (problems.length === 0 && message) problems.push(message);
  return { phase: "failed", problems };
}
