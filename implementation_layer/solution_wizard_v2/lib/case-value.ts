/**
 * A result value as a person would write it. The cases view shows what the
 * solution produced, and that is data of any shape: a list is lines, a record
 * is "label: value" lines, a boolean is Yes or No, nothing is a dash. No JSON
 * brackets or quotes reach the page; a shape this cannot read is kept as JSON
 * for a "Show raw" disclosure.
 */
import { humanize } from "@/lib/case-process";

export type ValueWords = { yes: string; no: string };

export type Pair = { label: string; value: ShownValue };

export type ShownValue =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  /** A list of plain values: one line each. */
  | { kind: "list"; items: string[] }
  /** One object: its fields as "label: value" lines. */
  | { kind: "pairs"; pairs: Pair[] }
  /** A list of objects: each one's fields, under the columns they share. */
  | { kind: "records"; columns: string[]; rows: Pair[][] }
  /** A shape with no plain reading; the JSON, for a disclosure. */
  | { kind: "raw"; json: string };

export const EMPTY_MARK = "—";

/** A record with more fields than this is laid out as pairs, not as a table row. */
export const TABLE_MAX_COLUMNS = 4;
/** A value longer than this needs a line of its own, not a table cell. */
export const TABLE_MAX_TEXT = 80;
/** How deep a value is read: a list of records whose fields hold lists or records. */
const MAX_DEPTH = 2;

const EMPTY: ShownValue = { kind: "empty" };

const isPlain = (v: unknown): v is string | number | boolean | null | undefined =>
  v === null || v === undefined || typeof v !== "object";
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function plain(value: string | number | boolean | null | undefined, words: ValueWords): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? words.yes : words.no;
  return String(value).trim();
}

/** Text that is itself a JSON list or object ('["a","b"]') is read as that. */
function parsedJson(text: string): unknown {
  if (!/^[[{]/.test(text) || !/[\]}]$/.test(text)) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function pairsOf(record: Record<string, unknown>, words: ValueWords, depth: number): Pair[] {
  return Object.keys(record).map((key) => ({
    label: humanize(key),
    value: formatValue(record[key], words, depth + 1),
  }));
}

export function formatValue(value: unknown, words: ValueWords, depth = 0): ShownValue {
  if (isPlain(value)) {
    const text = plain(value, words);
    if (!text) return EMPTY;
    const parsed = typeof value === "string" ? parsedJson(text) : undefined;
    return parsed === undefined ? { kind: "text", text } : formatValue(parsed, words, depth);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return EMPTY;
    if (value.every(isPlain)) {
      const items = value.map((item) => plain(item, words)).filter(Boolean);
      return items.length ? { kind: "list", items } : EMPTY;
    }
    if (depth < MAX_DEPTH && value.every(isObject)) {
      const columns: string[] = [];
      for (const row of value) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
      if (columns.length === 0) return EMPTY;
      // Every row carries every column, so a table has no holes and the pairs
      // of two records line up.
      const rows = value.map((row) =>
        columns.map((key) => ({ label: humanize(key), value: formatValue(row[key], words, depth + 1) })),
      );
      return { kind: "records", columns: columns.map(humanize), rows };
    }
  } else if (depth < MAX_DEPTH) {
    const pairs = pairsOf(value as Record<string, unknown>, words, depth);
    return pairs.length ? { kind: "pairs", pairs } : EMPTY;
  }
  return { kind: "raw", json: JSON.stringify(value, null, 2) };
}

/**
 * The value as plain text, for where there is no markup (a printed page) and
 * for measuring it. A list is a line per item; a record's fields are
 * "label: value" lines; records are parted by an empty line.
 */
export function valueText(shown: ShownValue): string {
  switch (shown.kind) {
    case "empty":
      return EMPTY_MARK;
    case "text":
      return shown.text;
    case "list":
      return shown.items.join("\n");
    case "pairs":
      return shown.pairs.map(pairLine).join("\n");
    case "records":
      return shown.rows.map((row) => row.map(pairLine).join("\n")).join("\n\n");
    case "raw":
      return shown.json;
  }
}

/** "Label: value" on one line; a value of several lines hangs under its label. */
export function pairLine({ label, value }: Pair): string {
  const text = valueText(value);
  return text.includes("\n") ? `${label}:\n${text.replace(/^/gm, "  ")}` : `${label}: ${text}`;
}

/**
 * How a list of records is laid out: a table while the fields are few and
 * short, otherwise each record as label and value pairs. Six columns of
 * sentences in one table wrap to a word a line.
 */
export function recordsLayout(shown: Extract<ShownValue, { kind: "records" }>): "table" | "pairs" {
  if (shown.columns.length > TABLE_MAX_COLUMNS) return "pairs";
  const long = shown.rows.some((row) =>
    row.some(({ value }) => value.kind === "raw" || valueText(value).length > TABLE_MAX_TEXT),
  );
  return long ? "pairs" : "table";
}

// -- the grounding check ---------------------------------------------------------

export type GroundingFlag = { field: string; value: ShownValue; reason: string };

/**
 * The values a failed grounding check is about. The generated solution's
 * check writes `hallucination_flags` (field, value, reason) beside `passed`;
 * a check that only says `passed` names none, and the list is empty.
 */
export function groundingFlags(validation: unknown, words: ValueWords): GroundingFlag[] {
  const flags = isObject(validation) ? validation.hallucination_flags : undefined;
  if (!Array.isArray(flags)) return [];
  return flags.filter(isObject).flatMap((flag) => {
    const field = typeof flag.field === "string" ? flag.field.trim() : "";
    const value = formatValue(flag.value, words, MAX_DEPTH - 1);
    if (!field && value.kind === "empty") return [];
    return [
      {
        // "line_item.article_code" is a field of a field, each with its label.
        field: field.split(".").map(humanize).join(" › "),
        value,
        reason: typeof flag.reason === "string" ? flag.reason.trim() : "",
      },
    ];
  });
}
