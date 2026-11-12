import type { ReactNode } from "react";

/**
 * The slim bar at the top of a session: its name, which is the page's
 * heading, and beside it the four gates of the wizard's process. Below the
 * desktop layout its left end is kept clear for the button that opens the
 * sidebar.
 */
export function SessionBar({
  title,
  children,
}: {
  /** The session's name, or a link back to the session from a page under it. */
  title: ReactNode;
  /** The gate row (components/gate-timeline). */
  children?: ReactNode;
}) {
  return (
    <div
      data-testid="session-bar"
      className="relative z-20 flex h-12 shrink-0 items-center gap-4 border-b border-border bg-surface pl-14 pr-4 sm:pr-6 lg:pl-6"
    >
      <h1 className="min-w-0 truncate text-sm font-semibold text-text max-md:flex-1 md:max-w-[40%]">
        {title}
      </h1>
      {children}
    </div>
  );
}
