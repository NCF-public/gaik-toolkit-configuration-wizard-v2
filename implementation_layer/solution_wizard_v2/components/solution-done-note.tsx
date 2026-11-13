"use client";

import { useSyncExternalStore } from "react";
import { runWarningsFor, subscribeResultStale } from "@/lib/poc-result-state";

/**
 * The quiet line of the finished solution's banner: what the package leaves
 * out, and before it, when the run the workspace shows finished with warnings,
 * that it did. The page knows the run's id and not its output; the workspace
 * under the banner reads the output, and says here what it found.
 */
export function SolutionDoneNote({
  sessionId,
  packageLine,
  warningsLine,
}: {
  sessionId: string;
  packageLine: string;
  warningsLine: string;
}) {
  const warnings = useSyncExternalStore(
    subscribeResultStale,
    () => runWarningsFor(sessionId),
    () => false,
  );
  return (
    <p className="text-xs text-text-secondary">
      {warnings && (
        <>
          <span className="font-medium text-text" data-testid="solution-done-warnings">
            {warningsLine}
          </span>{" "}
        </>
      )}
      {packageLine}
    </p>
  );
}
