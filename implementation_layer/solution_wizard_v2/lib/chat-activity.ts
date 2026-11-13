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
  /** Summary of a finished turn's steps, with {n}. */
  steps: string;
  /**
   * Plain words for the files the agent writes, by base name
   * ("use_case.blueprint.json" → "the solution plan"). A file not listed is
   * named as it is.
   */
  files: Record<string, string>;
  /** Accessible name of a diagram drawn in the chat. */
  diagram: string;
  /** Accessible name of a diagram whose steps are known, with {steps}. */
  diagramSteps: string;
  /** Shown in place of a diagram while it is still being written or drawn. */
  diagramDrawing: string;
  /** Opens a diagram at full size. */
  diagramExpand: string;
  /** Closes the full-size diagram. */
  diagramClose: string;
  /** The chat panel's own words; kept here because the page hands the chat this group. */
  panel: ChatPanelLabels;
};

export type ChatPanelLabels = {
  /** Under the chat title: where changes are asked for. */
  hint: string;
  /** Accessible name of the button that removes the reference chip. */
  referenceRemove: string;
  /** Group name of the background chips. */
  background: string;
  nonTechnical: string;
  /** The sentence the chip puts into the message field. */
  nonTechnicalText: string;
  technical: string;
  technicalText: string;
  /** The empty chat while it is the page (lib/session-start). */
  start: {
    /** The question the page opens with. */
    title: string;
    /** What the wizard does with the answer. */
    lede: string;
    /** In the field: what a first message tells. */
    placeholder: string;
    /** Group name of the examples. */
    examples: string;
    /** Each example's chip and the text it puts into the field. */
    exampleList: { title: string; prompt: string }[];
  };
  /** A gate approved in the panel, as an event line in the chat; with {n}. */
  gateApproved: string;
  /** The button the wizard offers when asked for the other language, and the
   *  message sent once the interface has switched; each in its own language. */
  languageOffer: Record<"fi" | "en", { label: string; message: string }>;
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

/** A file's plain name for the user, or its own name when it has none. */
export function fileName(file: string, labels: Pick<ChatActivityLabels, "files">): string {
  return Object.prototype.hasOwnProperty.call(labels.files, file) ? labels.files[file] : file;
}

/** "Writing the solution plan", "Reading raportti.pdf", "Running a check", … */
export function activityText(activity: ChatActivity, labels: ChatActivityLabels): string {
  if (activity.kind === "write") {
    return activity.file ? labels.writeFile.replace("{file}", () => fileName(activity.file!, labels)) : labels.write;
  }
  if (activity.kind === "read") {
    return activity.file ? labels.readFile.replace("{file}", () => fileName(activity.file!, labels)) : labels.read;
  }
  return labels[activity.kind];
}

/** Seconds since the message was sent, shown once the wait is long enough to wonder about. */
export function elapsedText(seconds: number, labels: ChatActivityLabels): string | null {
  if (seconds < 5) return null;
  return labels.elapsed.replace("{s}", String(Math.floor(seconds)));
}
