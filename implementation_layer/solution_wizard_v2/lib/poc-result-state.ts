/**
 * Whether the test result on the PoC tab still describes the package that is
 * there, and what a run said about its own result.
 *
 * Gate 3 approves a test run. A run that had succeeded stayed "succeeded" on
 * the page while the wizard rewrote the package behind it, and the gate could
 * be approved on a result the current package had never produced.
 */

export type ResultStaleInput = {
  /** The wizard is replying: it may be rewriting the package. */
  wizardReplying: boolean;
  /** A reply has ended and the package has not been read again since. */
  packageStale: boolean;
  /** Digest of the package that is there now; null where the api gives none (the mock). */
  packageVersion: string | null;
  /** The package version the result ran on; null when the page cannot tell. */
  resultVersion: string | null;
};

/**
 * True while the result is, or may be, that of an earlier package. A version
 * the page does not know (the mock store, a run from before the page was
 * loaded) is not held against the result: that is how the tab read it before.
 * It is over when a run of the package that is there has succeeded.
 */
export function resultIsStale(input: ResultStaleInput): boolean {
  if (input.wizardReplying || input.packageStale) return true;
  return (
    input.packageVersion !== null && input.resultVersion !== null && input.packageVersion !== input.resultVersion
  );
}

export type RunWarning = { code: string; message: string };

/**
 * The `warnings` of a run-output answer: what the run finished with that the
 * user should look at before trusting the result. An answer without the field
 * (an api that does not send it yet), or with an empty list, has none.
 */
export function runWarnings(raw: unknown): RunWarning[] {
  if (typeof raw !== "object" || raw === null) return [];
  const list = (raw as { warnings?: unknown }).warnings;
  if (!Array.isArray(list)) return [];
  const warnings: RunWarning[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const { code, message } = item as { code?: unknown; message?: unknown };
    if (typeof message !== "string" || !message.trim()) continue;
    warnings.push({ code: typeof code === "string" ? code : "", message: message.trim() });
  }
  return warnings;
}

// The PoC tab knows whether the result is stale; the gate's approve buttons
// (the bar under the workspace, the one under the wizard's reply) are drawn
// elsewhere on the page. The tab says it here and they read it, whichever of
// them is drawn first.
const staleBySession = new Map<string, boolean>();
const listeners = new Set<() => void>();

/** The PoC tab's word on its result; false when the tab goes away. */
export function publishResultStale(sessionId: string, stale: boolean): void {
  if ((staleBySession.get(sessionId) ?? false) === stale) return;
  if (stale) staleBySession.set(sessionId, true);
  else staleBySession.delete(sessionId);
  for (const listener of listeners) listener();
}

export function subscribeResultStale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resultStaleFor(sessionId: string): boolean {
  return staleBySession.get(sessionId) ?? false;
}
