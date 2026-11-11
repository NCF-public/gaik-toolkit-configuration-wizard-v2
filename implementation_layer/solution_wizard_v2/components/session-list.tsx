"use client";

import Link, { useLinkStatus } from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { DeleteSessionButton } from "@/components/delete-session-button";
import { GateTrack } from "@/components/gate-track";
import { Icon } from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import {
  fillQuery,
  matchesSearch,
  showsSearch,
  type GateMark,
  type SessionDay,
  type Standing,
} from "@/lib/session-list";

/** One session as the list shows it. The page fills in every text on the
 *  server, so the browser formats no dates and renders what the server did. */
export type SessionRow = {
  id: string;
  title: string;
  day: SessionDay;
  marks: GateMark[];
  standing: Standing;
  /** "Vaihe 6/13" */
  stepLabel: string;
  /** The phase the session is on; empty once it is done. */
  phase: string;
  updatedIso: string;
  /** Short, by day group: "14.32", "pe 6.11.", "30.10.2026". */
  updated: string;
  updatedFull: string;
};

export type SessionListLabels = {
  days: Record<SessionDay, string>;
  search: string;
  searchPlaceholder: string;
  /** "{q}" is the search. */
  noResults: string;
  clearSearch: string;
  done: string;
  waiting: string;
  rejected: string;
  updated: string;
  exportOpen: string;
  remove: {
    open: string;
    title: string;
    body: string;
    confirmLabel: string;
    confirm: string;
    cancel: string;
    mismatch: string;
    busy: string;
    protected: string;
    failed: string;
  };
};

const DAYS: SessionDay[] = ["today", "yesterday", "week", "earlier"];
const QUERY_MAX = 100;

/**
 * Rows and day headings glide to their new place when the list changes (a
 * search narrows it, a session is deleted) instead of jumping. Positions are
 * read from the layout, not the screen, so a glide in progress does not skew
 * the next one.
 */
function useGlide(signature: string) {
  const root = useRef<HTMLDivElement>(null);
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) {
      tops.current = new Map();
      return;
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    container.querySelectorAll<HTMLElement>("[data-glide]").forEach((el) => {
      const key = el.dataset.glide!;
      const top = el.offsetTop;
      next.set(key, top);
      const before = tops.current.get(key);
      if (still || before === undefined || before === top || !el.animate) return;
      el.animate(
        [{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }],
        { duration: 260, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      );
    });
    tops.current = next;
  }, [signature]);
  return root;
}

/** A spinner on the row that was clicked, while its session page loads. */
function Opening() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span className="session-opening inline-flex">
      <Icon name="loaderCircle" size={14} className="animate-spin text-brand" />
    </span>
  );
}

// On a phone the gate's state takes the line under the phase, so the time
// keeps its place at the end of the first line on every row.
const BELOW_ON_PHONE = "max-sm:order-last max-sm:basis-full";

function StandingText({ row, labels }: { row: SessionRow; labels: SessionListLabels }) {
  if (row.standing === "done") {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-success-text">
        <Icon name="check" size={14} />
        {labels.done}
      </span>
    );
  }
  return (
    <>
      <span className="text-text-secondary">{row.phase}</span>
      {row.standing === "waiting" && (
        <span className={`inline-flex items-center gap-1 font-medium text-brand-text ${BELOW_ON_PHONE}`}>
          <Icon name="flag" size={13} />
          {labels.waiting}
        </span>
      )}
      {row.standing === "rejected" && (
        <span className={`font-medium text-warning-text ${BELOW_ON_PHONE}`}>{labels.rejected}</span>
      )}
    </>
  );
}

/**
 * One session: the whole row opens it, and its download and delete buttons sit
 * in the corner on top of the link.
 */
function Row({
  row,
  labels,
  arriveAfter,
}: {
  row: SessionRow;
  labels: SessionListLabels;
  /** Its place in the first arrival, 0 for a row that shows up later. */
  arriveAfter: number;
}) {
  // Kept from the first render: a delay that changed under a running arrival
  // would restart it.
  const [delay] = useState(arriveAfter);
  return (
    <li
      data-glide={row.id}
      style={{ "--row": delay } as CSSProperties}
      className="session-row group/row relative hover:z-10 focus-within:z-10"
    >
      <Link
        href={`/sessions/${row.id}`}
        data-testid="session-card"
        className="block rounded-lg px-3 py-3 transition-colors duration-150 active:bg-surface-muted group-hover/row:bg-surface-muted/70"
      >
        {/* The title has the row's width; only the corner buttons are kept
            clear. */}
        <span className="block break-words pr-[4.5rem] text-[15px] font-semibold leading-snug text-text-strong transition-colors duration-150 group-hover/row:text-brand-text">
          {row.title}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-text-muted">
          <GateTrack marks={row.marks} title={row.stepLabel} />
          <span className="sr-only">{row.stepLabel}</span>
          <StandingText row={row} labels={labels} />
          <span className="ml-auto inline-flex items-center gap-2">
            <Opening />
            <time dateTime={row.updatedIso} title={row.updatedFull} className="tabular-nums">
              <span className="sr-only">{labels.updated} </span>
              {row.updated}
            </time>
          </span>
        </span>
      </Link>
      <div className="session-row-actions absolute right-1.5 top-1.5 flex items-center gap-0.5">
        <Tooltip label={labels.exportOpen}>
          <a
            href={`/api/sessions/${row.id}/export`}
            data-testid="export-session"
            aria-label={`${labels.exportOpen}: ${row.title}`}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-border/70 hover:text-text"
          >
            <Icon name="download" size={16} />
          </a>
        </Tooltip>
        <DeleteSessionButton sessionId={row.id} title={row.title} labels={labels.remove} />
      </div>
    </li>
  );
}

export function SessionList({
  rows,
  initialQuery,
  labels,
}: {
  rows: SessionRow[];
  /** The search in the address when the server rendered the page. */
  initialQuery: string;
  labels: SessionListLabels;
}) {
  // The field starts from the address, not from the rendered page: a step back
  // from a session shows the page as it was first loaded, while the address
  // still holds the search typed after that.
  const inAddress = (useSearchParams().get("q") ?? "").trim().slice(0, QUERY_MAX);
  const [typed, setTyped] = useState(inAddress);
  // A new search from the server (a navigation, or the list reloading after a
  // delete) replaces what the field holds; typing does not ask the server.
  const [served, setServed] = useState(initialQuery);
  if (served !== initialQuery) {
    setServed(initialQuery);
    setTyped(initialQuery);
  }
  // The first rows arrive one after another; a row that comes back into a
  // search later just fades in.
  const [arrived, setArrived] = useState(false);
  useEffect(() => setArrived(true), []);

  const searchShown = showsSearch(rows.length, typed.trim());
  const query = searchShown ? typed.trim() : "";
  const shown = query ? rows.filter((row) => matchesSearch(row.title, query)) : rows;
  const groups = DAYS.map((day) => ({ day, rows: shown.filter((row) => row.day === day) })).filter(
    (group) => group.rows.length > 0,
  );
  const list = useGlide(shown.map((row) => row.id).join(" "));

  const search = (value: string) => {
    setTyped(value);
    // The address follows the search, so a reload or a step back keeps it.
    const q = value.trim();
    window.history.replaceState(null, "", q ? `/?q=${encodeURIComponent(q)}` : "/");
  };

  const order = new Map(shown.map((row, i) => [row.id, i]));
  return (
    <div>
      {searchShown && (
        <div className="mb-5 flex items-center justify-between gap-4">
          <form
            role="search"
            action="/"
            onSubmit={(e) => e.preventDefault()}
            className="relative w-full transition-[width] duration-200 ease-out sm:w-64 sm:focus-within:w-80"
          >
            <label htmlFor="session-search" className="sr-only">
              {labels.search}
            </label>
            <Icon
              name="search"
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              id="session-search"
              name="q"
              type="search"
              value={typed}
              maxLength={QUERY_MAX}
              onChange={(e) => search(e.target.value)}
              placeholder={labels.searchPlaceholder}
              className="input-field pl-9"
            />
          </form>
          {query && (
            <p role="status" className="shrink-0 text-xs tabular-nums text-text-muted">
              {shown.length}/{rows.length}
            </p>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-text-secondary">
          {fillQuery(labels.noResults, query)}{" "}
          <Link href="/" onClick={() => setTyped("")} className="font-medium text-brand-text underline">
            {labels.clearSearch}
          </Link>
        </p>
      ) : (
        <div ref={list} className="relative space-y-6">
          {groups.map(({ day, rows: dayRows }) => (
            <section key={day} aria-labelledby={`day-${day}`}>
              <h2
                id={`day-${day}`}
                data-glide={`day-${day}`}
                className="mb-1 text-xs font-medium text-text-muted"
              >
                {labels.days[day]}
              </h2>
              <ul className="-mx-3">
                {dayRows.map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    labels={labels}
                    arriveAfter={arrived ? 0 : Math.min(order.get(row.id) ?? 0, 8)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
