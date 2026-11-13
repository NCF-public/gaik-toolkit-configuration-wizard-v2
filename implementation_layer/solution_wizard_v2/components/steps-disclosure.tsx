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
  besideButton = true,
}: {
  /** "Step 1/13", the line that opens it. */
  summary: string;
  children: ReactNode;
  /** The chat button shares the summary's line, so the list opens below it.
   *  False where the line stands alone (the chat is the page). */
  besideButton?: boolean;
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
      {/* Opens below the chat button that shares the line with the summary. */}
      {open && <div className={`mb-2 max-w-sm ${besideButton ? "mt-7" : "mt-2"}`}>{children}</div>}
    </div>
  );
}
