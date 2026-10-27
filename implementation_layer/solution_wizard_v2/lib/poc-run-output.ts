/**
 * What a sandbox run wrote to `output/`, as the PoC tab shows it.
 *
 * wizard_api reads the run's log between the output markers and answers with
 * the same reading a case gets (`GET /sessions/{id}/runs/{run_id}/output`):
 * the record (the JSON whose keys are the output fields), the grounding check,
 * the transcript, the document, and every printed file. The tab used to show
 * the raw log only, with the result somewhere in it.
 */

import { humanize as fieldLabel, show as valueText } from "./case-process";

export type RunRecord = Record<string, unknown>;
export type RunOutputFile = { name: string; body: string };
/** A file of `output/` the run printed for download, any type (a PDF report). */
export type RunDownload = { name: string; size: number };

export type PocRunOutput = {
  runId: string | null;
  record: RunRecord | RunRecord[] | null;
  validation: (RunRecord & { passed?: boolean }) | null;
  transcript: string;
  document: string;
  files: RunOutputFile[];
  downloads: RunDownload[];
  /** Files over the download limit, named so their absence is not a mystery. */
  skipped: RunDownload[];
};

export const NO_RUN_OUTPUT: PocRunOutput = {
  runId: null,
  record: null,
  validation: null,
  transcript: "",
  document: "",
  files: [],
  downloads: [],
  skipped: [],
};

const isRecord = (v: unknown): v is RunRecord =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function pocRunOutput(raw: unknown): PocRunOutput {
  if (!isRecord(raw)) return NO_RUN_OUTPUT;
  const record = isRecord(raw.record)
    ? raw.record
    : Array.isArray(raw.record) && raw.record.every(isRecord)
      ? (raw.record as RunRecord[])
      : null;
  const files = Array.isArray(raw.files)
    ? raw.files
        .filter(isRecord)
        .filter((f) => typeof f.name === "string" && typeof f.body === "string")
        .map((f) => ({ name: f.name as string, body: f.body as string }))
    : [];
  const sized = (v: unknown): RunDownload[] =>
    Array.isArray(v)
      ? v
          .filter(isRecord)
          .filter((f) => typeof f.name === "string" && typeof f.size === "number")
          .map((f) => ({ name: f.name as string, size: f.size as number }))
      : [];
  return {
    runId: typeof raw.runId === "string" ? raw.runId : typeof raw.run_id === "string" ? raw.run_id : null,
    record,
    validation: isRecord(raw.validation) ? (raw.validation as PocRunOutput["validation"]) : null,
    transcript: typeof raw.transcript === "string" ? raw.transcript : "",
    document: typeof raw.document === "string" ? raw.document : "",
    files,
    downloads: sized(raw.downloads),
    skipped: sized(raw.skipped),
  };
}

/** The run printed at least one output file, as text or for download. */
export const hasRunOutput = (o: PocRunOutput): boolean =>
  o.files.length > 0 || o.downloads.length > 0;

/** The tab's link to one output file of a run. */
export const runFileHref = (sessionId: string, runId: string, name: string): string =>
  `/api/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(name)}`;

/** A file size for people: bytes, kB or MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The same labelling and value text as the case view (`lib/case-process`). */
export { humanize as fieldLabel, show as valueText } from "./case-process";

/** The record's fields in the order the run wrote them, each with its value as text. */
export function recordRows(record: RunRecord): { field: string; label: string; value: string }[] {
  return Object.entries(record).map(([field, value]) => ({
    field,
    label: fieldLabel(field),
    value: valueText(value),
  }));
}

export type DocumentSection = { title: string; text: string };

/**
 * A document result (a generated report) is a record whose `sections` are
 * titled texts; those read better as a document than as a table. Null for an
 * ordinary record.
 */
export function documentSections(record: RunRecord): DocumentSection[] | null {
  const sections = record.sections;
  if (!Array.isArray(sections) || sections.length === 0 || !sections.every(isRecord)) return null;
  return sections.map((s, i) => ({
    title: typeof s.title === "string" && s.title ? s.title : `${i + 1}`,
    text: valueText(s.text),
  }));
}

/**
 * What the tab says about a run that ended. The done frame carries the Job's
 * `message` and, for a run that did not succeed, a `reason` the api read from
 * the log's last lines (the exception line under the traceback). The reason
 * is the thing to show; the Job's own words name no cause.
 */
export function runEndMessage(evt: {
  phase?: unknown;
  reason?: unknown;
  message?: unknown;
}): string | null {
  const reason = typeof evt.reason === "string" && evt.reason.trim() ? evt.reason.trim() : null;
  const message = typeof evt.message === "string" && evt.message.trim() ? evt.message.trim() : null;
  if (evt.phase === "succeeded") return message;
  return reason ?? message;
}

/** A run the PoC tab picks up again after a reload: where it got to and what to say. */
export type RestoredRun = {
  phase: "running" | "succeeded" | "failed" | "timeout";
  message: string | null;
  finished: boolean;
};

/**
 * The api's answer for the session's latest run (GET /runs/{id}), read for a tab
 * that was not there when the run ended. Without this, a reload said the PoC had
 * never been run while its result and downloads were still on the server. An
 * answer that says nothing usable leaves the tab as it was.
 */
export function restoredRun(body: unknown): RestoredRun | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const phase = b.phase;
  if (phase === "pending" || phase === "running") {
    if (b.finished === true) return null;
    return { phase: "running", message: null, finished: false };
  }
  if (phase === "succeeded" || phase === "failed" || phase === "timeout") {
    return {
      phase,
      message: runEndMessage({ phase, reason: b.reason, message: b.message }),
      finished: true,
    };
  }
  return null;
}
