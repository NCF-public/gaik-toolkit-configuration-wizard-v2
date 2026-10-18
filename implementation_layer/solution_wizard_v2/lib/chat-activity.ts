/**
 * The chat's progress line while the agent works.
 *
 * wizard_api sends `{"activity": {"kind", "file"}}` when the agent starts a
 * tool: writing or reading a file, running a check, searching. Long steps
 * (schema generation, writing the package) used to show only the typing dots
 * for minutes. The kind and a file's base name come from the server; the
 * words are chosen here, in the user's language.
 */

export type ActivityKind = "write" | "read" | "run" | "search" | "work";
export type ChatActivity = { kind: ActivityKind; file: string | null };

export type ChatActivityLabels = {
  write: string;
  writeFile: string;
  read: string;
  readFile: string;
  run: string;
  search: string;
  work: string;
  elapsed: string;
};

const KINDS: ReadonlySet<string> = new Set(["write", "read", "run", "search", "work"]);

/** The activity of one stream event, or null when it has none. */
export function parseActivity(evt: unknown): ChatActivity | null {
  if (!evt || typeof evt !== "object") return null;
  const raw = (evt as { activity?: unknown }).activity;
  if (!raw || typeof raw !== "object") return null;
  const { kind, file } = raw as { kind?: unknown; file?: unknown };
  if (typeof kind !== "string" || !KINDS.has(kind)) return null;
  return { kind: kind as ActivityKind, file: typeof file === "string" && file ? file : null };
}

/** "Writing output_schema.py", "Running a check", … */
export function activityText(activity: ChatActivity, labels: ChatActivityLabels): string {
  if (activity.kind === "write") {
    return activity.file ? labels.writeFile.replace("{file}", activity.file) : labels.write;
  }
  if (activity.kind === "read") {
    return activity.file ? labels.readFile.replace("{file}", activity.file) : labels.read;
  }
  return labels[activity.kind];
}

/** Seconds since the message was sent, shown once the wait is long enough to wonder about. */
export function elapsedText(seconds: number, labels: ChatActivityLabels): string | null {
  if (seconds < 5) return null;
  return labels.elapsed.replace("{s}", String(Math.floor(seconds)));
}
