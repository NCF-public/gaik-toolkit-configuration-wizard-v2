import { acceptAttribute, caseErrorText, type AcceptedInput } from "@/lib/case-error";
import { CASE_STRINGS } from "@/lib/case-strings";
import { fillTemplate } from "@/lib/chat-template";
import type { Dict } from "@/lib/i18n";
import type { PocInputFile } from "@/lib/poc-auto-run";
import { pocPathOf } from "@/lib/poc-file";
import { MAX_INPUT_BYTES } from "@/lib/upload-limits";

export type ExpectedPocInput = {
  kind: string;
  label: string;
  extensions: string[];
  multiple: boolean;
  required: boolean;
  canSynthesize: boolean;
};

export type InputSlotStatus = {
  slot: ExpectedPocInput;
  matchedFiles: PocInputFile[];
  satisfied: boolean;
  /** Filled by the wizard's example alone: the automatic run waits for the user's own file. */
  exampleOnly: boolean;
};

export type InputReadiness = {
  slots: InputSlotStatus[];
  missingRequired: ExpectedPocInput[];
  allRequiredPresent: boolean;
  acceptAttr: string;
};

export function normalizeExpectedInputs(raw: unknown): ExpectedPocInput[] {
  if (!Array.isArray(raw)) return [];
  const out: ExpectedPocInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const kind = typeof obj.kind === "string" && obj.kind.trim() ? obj.kind.trim().toLowerCase() : "file";
    const label = typeof obj.label === "string" && obj.label.trim() ? obj.label.trim() : kind;
    const extensions = Array.isArray(obj.extensions)
      ? obj.extensions
          .filter((e): e is string => typeof e === "string" && e.trim().startsWith("."))
          .map((e) => e.trim().toLowerCase())
      : [];
    out.push({
      kind,
      label,
      extensions,
      multiple: obj.multiple !== false,
      // Only an explicit true: the scaffolder writes a slot per input kind
      // without the key, and those are often alternatives (pdf or txt).
      required: obj.required === true,
      canSynthesize: Boolean(obj.can_synthesize ?? obj.canSynthesize),
    });
  }
  return out;
}

export function normalizeAcceptedInputs(raw: unknown): AcceptedInput[] {
  if (!Array.isArray(raw)) return [];
  const out: AcceptedInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const label = typeof obj.label === "string" ? obj.label.trim() : "";
    if (!label) continue;
    const extensions = Array.isArray(obj.extensions)
      ? obj.extensions.filter((e): e is string => typeof e === "string" && e.trim().startsWith("."))
      : [];
    out.push({
      ...(typeof obj.kind === "string" ? { kind: obj.kind } : {}),
      label,
      extensions,
    });
  }
  return out;
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * Checks whether every required input slot has at least one matching file in
 * `sample_input/`. A slot without `required` is one of the inputs the package
 * can read, not one it must have, so with no required slot (or none listed)
 * any file counts as ready, as before the slots were read.
 */
export function evaluateInputReadiness(
  expectedInputs: readonly ExpectedPocInput[],
  files: readonly PocInputFile[],
  acceptedInputs: readonly AcceptedInput[] = [],
): InputReadiness {
  const slots: InputSlotStatus[] = expectedInputs.map((slot) => {
    const allowed = new Set(slot.extensions.map((e) => e.toLowerCase()));
    const matchedFiles = files.filter((f) =>
      allowed.size === 0 ? true : allowed.has(fileExtension(f.name)),
    );
    return {
      slot,
      matchedFiles,
      satisfied: matchedFiles.length > 0,
      exampleOnly: matchedFiles.length > 0 && matchedFiles.every((f) => f.uploaded === false),
    };
  });
  const missingRequired = slots.filter((s) => s.slot.required && !s.satisfied).map((s) => s.slot);
  const allRequiredPresent = missingRequired.length === 0;

  const expectedExts = expectedInputs.flatMap((s) => s.extensions);
  const acceptAttr =
    expectedExts.length > 0
      ? [...new Set(expectedExts)].join(",")
      : acceptAttribute([...acceptedInputs]);

  return { slots, missingRequired, allRequiredPresent, acceptAttr };
}

/**
 * Localizes upload errors on the PoC tab using the same error-code vocabulary
 * as `/cases` so users never see raw English backend messages or a vague
 * "Tiedoston lisäys epäonnistui" when a file type, size or scanner check fails.
 *
 * An `input_rejected` refusal is worded from its `detail.reason` (the reason),
 * never from the English `message`. An older api sends no code; that refusal
 * is then named generically rather than guessed from its words.
 */
export function formatPocUploadError(
  status: number,
  body: unknown,
  t: Dict,
  accepted: AcceptedInput[],
  fallback: string,
): string {
  const s = CASE_STRINGS[t.locale];
  const detail = (body as { detail?: unknown } | null)?.detail;
  const code =
    detail && typeof detail === "object"
      ? String((detail as { error?: unknown }).error ?? "")
      : "";
  if (
    code === "input_type_not_accepted" ||
    code === "input_too_large" ||
    code === "input_unsafe" ||
    code === "scanner_unavailable" ||
    code === "input_exists" ||
    status === 413 ||
    status === 415
  ) {
    return caseErrorText(status, body, s, fallback, accepted);
  }
  if (code === "sample_not_supported") return t.pocUploadSampleNotSupported;
  if (code === "input_rejected") {
    const reason = detail && typeof detail === "object" ? (detail as { reason?: unknown }).reason : undefined;
    if (reason === "too_large") {
      return s.errors.tooLarge.replace("{mb}", String(Math.floor(MAX_INPUT_BYTES / (1024 * 1024))));
    }
    if (typeof reason === "string" && Object.hasOwn(t.pocUploadRejected, reason)) {
      return t.pocUploadRejected[reason as keyof Dict["pocUploadRejected"]];
    }
    return t.pocUploadRejected.other;
  }
  if (status === 404) return t.pocUploadNotFound;
  if (status === 409) return t.pocUploadNoPackage;
  if (status >= 500) {
    return s.networkError;
  }
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string") {
    const msg = ((detail as { message: string }).message || "").trim();
    if (msg) return msg;
  }
  return fallback;
}

const NO_INPUT_RE =
  /no input with \[([^\]]+)\] under [^\s;]*sample_input[^;]*(?:;\s*files there:\s*\[([^\]]*)\])?/i;

function parseQuotedList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

/**
 * Turns `ERROR: no input with ['.pdf', ...] under sample_input; files there: [...]`
 * into a plain-language explanation so users immediately understand which input
 * type is missing instead of parsing Python path/list syntax.
 */
export function explainRunInputError(runMessage: string | null | undefined, t: Dict): string | null {
  if (!runMessage) return null;
  const match = NO_INPUT_RE.exec(runMessage);
  if (!match) return null;
  const wanted = parseQuotedList(match[1]);
  const present = match[2] ? parseQuotedList(match[2]) : [];
  if (wanted.length === 0) return null;

  const shownWanted = wanted.slice(0, 6).join(", ");
  const hasAudio = wanted.some((e) => [".wav", ".mp3", ".m4a", ".ogg", ".flac"].includes(e.toLowerCase()));
  const hasPdf = wanted.some((e) => e.toLowerCase() === ".pdf");

  const kind: "audio" | "document" | "file" = hasAudio && !hasPdf ? "audio" : hasPdf ? "document" : "file";
  const missingLabel = fillTemplate(t.pocRunInputKind[kind], { list: shownWanted });

  if (present.length === 0) return fillTemplate(t.pocRunInputMissing, { kind: missingLabel });
  return fillTemplate(t.pocRunInputMissingMore, { kind: missingLabel, present: present.join(", ") });
}

export type KeyPackageFile = {
  /** Full entry as shown in the package tree (`poc/README.md`). */
  treePath: string;
  /** Path passed to PocFileEditor (`README.md`). */
  pocPath: string;
  /** File basename (`README.md`). */
  name: string;
  /** Short plain-language role label. */
  role: string;
};

/**
 * Surfaces the handful of files a user most often wants to inspect first
 * (README, entrypoint, config, extraction prompt, output schema) as direct
 * quick-open links.
 */
export function keyPackageFiles(packageFiles: readonly string[], t: Dict): KeyPackageFile[] {
  const candidates: Array<{
    match: (p: string) => boolean;
    role: keyof Dict["pocKeyFileRole"];
  }> = [
    { match: (p) => p === "README.md", role: "guide" },
    { match: (p) => p === "run_poc.py", role: "entrypoint" },
    { match: (p) => p === "config.yaml", role: "config" },
    {
      match: (p) => p.startsWith("prompts/") && (p.endsWith(".md") || p.endsWith(".txt")),
      role: "prompt",
    },
    {
      match: (p) => p === "schemas/output_schema.py" || p === "schemas/output_schema.json",
      role: "schema",
    },
  ];
  const seen = new Set<string>();
  const picked: KeyPackageFile[] = [];
  for (const candidate of candidates) {
    const found = packageFiles.find((entry) => {
      const inner = pocPathOf(entry);
      return inner !== null && !seen.has(inner) && candidate.match(inner);
    });
    if (!found) continue;
    const pocPath = pocPathOf(found)!;
    seen.add(pocPath);
    picked.push({
      treePath: found,
      pocPath,
      name: pocPath.split("/").pop() ?? pocPath,
      role: t.pocKeyFileRole[candidate.role],
    });
  }
  return picked;
}

/**
 * Files the backend always opens read-only (AI marker, generated test page,
 * sample inputs, run outputs). Shown with a quiet lock indicator in the file
 * tree so read-only files are predictable before clicking.
 */
export function isAlwaysReadOnlyPackagePath(treePath: string): boolean {
  const inner = pocPathOf(treePath);
  if (inner === null) return true;
  const parts = inner.split("/");
  if (parts.at(-1) === "AI-GENERATED.json") return true;
  if (parts[0] === "sample_input" || parts[0] === "output") return true;
  if (inner === "app.py" || parts[0] === "ui") return true;
  return false;
}
