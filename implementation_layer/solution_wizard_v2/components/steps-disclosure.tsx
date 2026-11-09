"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "./icons";

/**
 * The timeline on a screen too narrow for its column: the step line opens it
 * under the step's title. It is rendered only while open, so the page never
 * holds a second copy of the timeline.
 */
export function StepsDisclosure({
  summary,
  children,
}: {
  /** "Step 1/13", the line that opens it. */
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded text-xs text-text-muted hover:text-text"
        data-testid="steps-disclosure"
      >
        {summary}
        <Icon
          name="chevronDown"
          size={12}
          className={`transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="mt-2 max-w-sm">{children}</div>}
    </div>
  );
}
