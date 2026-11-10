"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

// During gathering (steps 1–3) the user cannot skip ahead manually — the wizard
// advances on its own once the agent has collected the requirements. The button
// stays visible, but pressing it explains that, rather than advancing. The
// explanation opens above the button, so neither the button nor the footer
// moves. It closes on a press outside it or on Escape; the listeners sit on the
// document because Safari does not focus a pressed button, so blur never comes.
export function GatheringAdvanceButton({
  label,
  hint,
}: {
  label: string;
  hint: string;
}) {
  const [nudged, setNudged] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!nudged) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setNudged(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNudged(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [nudged]);

  return (
    // ml-auto keeps the button (and the hint anchored to it) on the right when
    // the footer wraps on a narrow screen.
    <div ref={wrapRef} className="relative ml-auto">
      <button
        type="button"
        onClick={() => setNudged(true)}
        aria-describedby={nudged ? "gathering-advance-hint" : undefined}
        className="btn-secondary"
      >
        {label}
        <Icon name="arrowRight" size={16} />
      </button>
      {nudged && (
        <span
          id="gathering-advance-hint"
          role="status"
          className="absolute bottom-full right-0 z-20 mb-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning-text shadow-md transition-[opacity,translate] duration-150 starting:translate-y-1 starting:opacity-0"
        >
          {hint}
        </span>
      )}
    </div>
  );
}
