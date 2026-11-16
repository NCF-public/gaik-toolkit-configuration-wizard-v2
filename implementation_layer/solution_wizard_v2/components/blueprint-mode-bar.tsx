import type { ReactNode, Ref } from "react";

/**
 * The first row of the Blueprint tab's form: where the draft stands and, at
 * the row's end, "Valmis", the way out of the form. It stays at the top of the
 * tab as the tab scrolls, so both are always in view; for that it is a direct
 * child of the view it heads. The read view has no such row: its one control,
 * "Muokkaa blueprintia", is at the end of the tab row (workspace-panel).
 */
export function BlueprintModeBar({
  mode = "edit",
  children,
  control,
  ref,
}: {
  mode?: "edit";
  /** The row itself, for whoever needs to know how much of the tab's top it covers. */
  ref?: Ref<HTMLDivElement>;
  /** What the view says about itself; the row's end is the control's. */
  children?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div
      ref={ref}
      className="sticky top-0 z-10 flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 bg-app pb-3 -mb-3"
      data-testid="blueprint-mode-bar"
      data-mode={mode}
    >
      {children}
      {control}
    </div>
  );
}
