import type { ReactNode } from "react";

/**
 * The Blueprint tab's first row, the same in both of its views: what the view
 * is (read-only and why, or where the draft stands) and, at the row's end, the
 * one control that changes it: "Muokkaa" while reading, "Valmis" while
 * editing. It stays at the top of the tab as the tab scrolls, so the way out
 * of a long form and its save status are always in view; for that it is a
 * direct child of the view it heads.
 */
export function BlueprintModeBar({
  mode,
  children,
  control,
}: {
  mode: "read" | "edit";
  /** What the view says about itself; the row's end is the control's. */
  children?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div
      className="sticky top-0 z-10 flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 bg-app pb-3 -mb-3"
      data-testid="blueprint-mode-bar"
      data-mode={mode}
    >
      {children}
      {control}
    </div>
  );
}
