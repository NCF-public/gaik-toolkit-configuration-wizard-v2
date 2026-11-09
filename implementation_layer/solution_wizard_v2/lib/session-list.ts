/** The day groups of the session list, newest first. */
export type SessionDay = "today" | "yesterday" | "week" | "earlier";

// Days are counted in Finland's time, where the wizard's users are: the server
// runs on UTC, and a session from 01:30 would otherwise fall on "yesterday".
const TIME_ZONE = "Europe/Helsinki";
const DAY_MS = 86_400_000;

/** "2026-11-09": the calendar day of `date` in Finland, comparable as text. */
function dayKey(date: Date): string {
  return date.toLocaleDateString("sv-SE", { timeZone: TIME_ZONE });
}

/**
 * Sessions grouped by the day they were last updated: today, yesterday, the
 * five days before, and earlier. Order within a group is kept, and empty
 * groups are left out.
 */
export function groupSessionsByDay<T extends { updatedAt: string }>(
  sessions: T[],
  now: Date,
): { day: SessionDay; sessions: T[] }[] {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - DAY_MS));
  const weekStart = dayKey(new Date(now.getTime() - 6 * DAY_MS));
  const groups: Record<SessionDay, T[]> = { today: [], yesterday: [], week: [], earlier: [] };
  for (const session of sessions) {
    const key = dayKey(new Date(session.updatedAt));
    if (key >= today) groups.today.push(session);
    else if (key === yesterday) groups.yesterday.push(session);
    else if (key >= weekStart) groups.week.push(session);
    else groups.earlier.push(session);
  }
  return (["today", "yesterday", "week", "earlier"] as const)
    .filter((day) => groups[day].length > 0)
    .map((day) => ({ day, sessions: groups[day] }));
}

/** Whether a session's title holds the search, ignoring case. */
export function matchesSearch(title: string, query: string): boolean {
  return title.toLocaleLowerCase("fi").includes(query.toLocaleLowerCase("fi"));
}
