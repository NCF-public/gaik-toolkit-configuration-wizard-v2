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
 * What step 1 says about the package. "ready" (ready to run) needs the files
 * complete and the preflight passed: complete files alone ("unchecked", shown
 * as a generated package) said nothing about whether the run would start, and
 * a failed preflight is shown as errors, not as ready. With no sandbox the
 * check never runs and the package stays "unchecked".
 */
export type PackageStatus =
  | "loading"
  | "missing"
  | "incomplete"
  | "unchecked"
  | "checking"
  | "failed"
  | "ready";

export function packageStatus(input: {
  loaded: boolean;
  generated: boolean;
  /** The files are all there (the API's `ready`). */
  complete: boolean;
  preflight: PreflightPhase;
}): PackageStatus {
  if (!input.loaded) return "loading";
  if (!input.generated) return "missing";
  if (!input.complete) return "incomplete";
  if (input.preflight === "running") return "checking";
  if (input.preflight === "failed") return "failed";
  if (input.preflight === "ok") return "ready";
  return "unchecked";
}

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

/**
 * Whether a finished check says something about the package: it passed, or
 * its log named problems. A Job that never got to the check (its time limit,
 * a lost stream) fails without a finding; that is shown but not remembered,
 * so the next visit checks again instead of repeating a failure of the sandbox.
 */
export function preflightIsFinding(phase: string, lines: string[]): boolean {
  return phase === "succeeded" || preflightProblems(lines).length > 0;
}

/**
 * What one browser tab remembers of a session's preflight, in sessionStorage.
 * Opening the PoC tab starts a check, and the PoC tab is where a session at
 * steps 10-13 opens: without this every reload started a new sandbox Job for
 * a version this tab had already checked. A check still going when the page
 * was reloaded is followed again by its run id rather than started anew.
 */
export type StoredPreflight = {
  version: string;
  runId: string | null;
  phase: "running" | "ok" | "failed";
  problems: string[];
};

/** Only what getItem/setItem/removeItem need, so a test can pass a stub. */
export type PreflightStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const preflightStorageKey = (sessionId: string): string => `gaik-wizard:preflight:${sessionId}`;

/** A stored entry, or null for nothing, garbage or a shape this code does not know. */
export function parseStoredPreflight(raw: string | null): StoredPreflight | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.version !== "string" || !v.version) return null;
  if (v.phase !== "running" && v.phase !== "ok" && v.phase !== "failed") return null;
  const runId = typeof v.runId === "string" && v.runId ? v.runId : null;
  if (v.phase === "running" && !runId) return null;
  const problems = Array.isArray(v.problems) ? v.problems.filter((p): p is string => typeof p === "string") : [];
  return { version: v.version, runId, phase: v.phase, problems };
}

/** The stored entry for the session; null when storage is missing or throws. */
export function readStoredPreflight(store: PreflightStore | null, sessionId: string): StoredPreflight | null {
  if (!store) return null;
  try {
    return parseStoredPreflight(store.getItem(preflightStorageKey(sessionId)));
  } catch {
    return null;
  }
}

/** Remember the entry (null forgets it). Storage that is full or blocked is ignored. */
export function writeStoredPreflight(
  store: PreflightStore | null,
  sessionId: string,
  entry: StoredPreflight | null,
): void {
  if (!store) return;
  try {
    if (entry) store.setItem(preflightStorageKey(sessionId), JSON.stringify(entry));
    else store.removeItem(preflightStorageKey(sessionId));
  } catch {
    // Private mode or a full store: the tab checks again next time, as before.
  }
}
