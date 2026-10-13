"use client";

import { useState } from "react";

// During gathering (steps 1–3) the user cannot skip ahead manually — the wizard
// advances on its own once the agent has collected the requirements. The button
// stays visible, but pressing it explains that, rather than advancing.
export function GatheringAdvanceButton({
  label,
  hint,
}: {
  label: string;
  hint: string;
}) {
  const [nudged, setNudged] = useState(false);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setNudged(true)}
        aria-describedby={nudged ? "gathering-advance-hint" : undefined}
        className="btn-brand"
      >
        {label}
      </button>
      {nudged && (
        <span
          id="gathering-advance-hint"
          role="status"
          className="max-w-sm text-right text-xs text-warning-text"
        >
          {hint}
        </span>
      )}
    </div>
  );
}
