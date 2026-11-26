"use client";

// Maintenance mode in an open page (lib/maintenance): the banner about a
// planned break, which the reader can close for this tab, and the watch that
// reloads the page into the maintenance page once the break begins.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { watchForMaintenance } from "@/lib/maintenance-watch";

const DISMISS_KEY = "gaik.maintenanceBannerClosed";

/**
 * The banner's height, which the page makes room for (globals.css: body's top
 * padding; the app shell's height): it covers no control, the mobile sidebar
 * button included.
 */
const OFFSET_VAR = "--maintenance-offset";

function readClosed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY);
  } catch {
    // Storage refused (private mode): the banner simply shows.
    return null;
  }
}

// Nothing else writes the key in this tab; closing it is tracked in state.
const subscribe = () => () => {};

export function MaintenanceNotice({ bannerText, closeLabel }: { bannerText: string | null; closeLabel: string }) {
  // Closed for this text only: a changed notice shows again.
  const closedText = useSyncExternalStore(subscribe, readClosed, () => null);
  const [closedNow, setClosedNow] = useState(false);

  const bannerRef = useRef<HTMLDivElement>(null);
  const shown = !!bannerText && !closedNow && closedText !== bannerText;

  useEffect(() => watchForMaintenance(window, () => window.location.reload()), []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const banner = bannerRef.current;
    if (!shown || !banner) {
      root.style.removeProperty(OFFSET_VAR);
      return;
    }
    const update = () => root.style.setProperty(OFFSET_VAR, `${banner.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(banner);
    return () => {
      observer.disconnect();
      root.style.removeProperty(OFFSET_VAR);
    };
  }, [shown]);

  if (!shown || !bannerText) return null;
  return (
    // Under the mobile sidebar button (z-32) and the open sidebar (z-40); on a
    // narrow screen the text starts right of that button.
    <div ref={bannerRef} className="fixed inset-x-0 top-0 z-30 border-b border-warning-border bg-warning-bg">
      <div
        role="status"
        className="mx-auto flex max-w-3xl items-start gap-3 py-2 pl-12 pr-4 text-sm text-warning-text lg:px-4"
      >
        <p className="whitespace-pre-line">{bannerText}</p>
        <button
          type="button"
          className="shrink-0 rounded px-1 font-medium underline-offset-2 hover:underline"
          onClick={() => {
            try {
              window.sessionStorage.setItem(DISMISS_KEY, bannerText);
            } catch {
              // Not kept; closed until the next page load.
            }
            setClosedNow(true);
          }}
        >
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
