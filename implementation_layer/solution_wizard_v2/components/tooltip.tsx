import type { ReactNode } from "react";

/** A short label shown on hover and on keyboard focus. */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden w-max max-w-64 rounded-md bg-text px-2 py-1 text-xs font-normal text-surface shadow-md group-hover/tip:block group-focus-within/tip:block"
      >
        {label}
      </span>
    </span>
  );
}
