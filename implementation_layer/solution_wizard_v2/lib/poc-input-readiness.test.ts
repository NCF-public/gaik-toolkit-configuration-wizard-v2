import { describe, expect, it } from "vitest";
import { dictionary } from "./i18n";
import {
  evaluateInputReadiness,
  explainRunInputError,
  formatPocUploadError,
  isAlwaysReadOnlyPackagePath,
  keyPackageFiles,
  normalizeExpectedInputs,
} from "./poc-input-readiness";

const fi = dictionary("fi");
const en = dictionary("en");

describe("evaluateInputReadiness", () => {
  const hybrid = normalizeExpectedInputs([
    {
      kind: "audio",
      label: "Äänite",
      extensions: [".wav", ".mp3", ".m4a"],
      multiple: true,
      required: true,
      can_synthesize: false,
    },
    {
      kind: "document",
      label: "Asiakirja",
      extensions: [".pdf", ".docx"],
      multiple: true,
      required: true,
      can_synthesize: true,
    },
  ]);

  it("reports missing document slot when only an MP3 is uploaded", () => {
    const readiness = evaluateInputReadiness(hybrid, [
      { name: "webinar_in_finnish_audio_1min.mp3", bytes: 12000, uploaded: true },
    ]);
    expect(readiness.allRequiredPresent).toBe(false);
    expect(readiness.missingRequired.map((s) => s.kind)).toEqual(["document"]);
    expect(readiness.slots[0].satisfied).toBe(true);
    expect(readiness.slots[1].satisfied).toBe(false);
    expect(readiness.acceptAttr).toBe(".wav,.mp3,.m4a,.pdf,.docx");
  });

  it("marks allRequiredPresent once both audio and PDF are present", () => {
    const readiness = evaluateInputReadiness(hybrid, [
      { name: "meeting.mp3", bytes: 12000, uploaded: true },
      { name: "example_document.pdf", bytes: 4200, uploaded: false },
    ]);
    expect(readiness.allRequiredPresent).toBe(true);
    expect(readiness.missingRequired).toEqual([]);
  });

  it("treats empty expectedInputs as ready for backwards compatibility", () => {
    const readiness = evaluateInputReadiness([], []);
    expect(readiness.allRequiredPresent).toBe(true);
  });

  it("offers every API-accepted format even if only one has a checklist slot", () => {
    const accepted = [{ label: "PDF", extensions: [".pdf"] }, { label: "JSON", extensions: [".json"] }];
    expect(evaluateInputReadiness(hybrid, [], accepted).acceptAttr).toBe(".pdf,.json");
    const wildcard = normalizeExpectedInputs([{ kind: "file" }, { kind: "document", extensions: [".pdf"] }]);
    expect(evaluateInputReadiness(wildcard, []).acceptAttr).toBe("");
  });

  // The scaffolder writes a slot per input kind without "required": a custom
  // package whose input_types are pdf and txt reads either (PR #338 review).
  const alternatives = normalizeExpectedInputs([
    { kind: "document", label: "Asiakirja", extensions: [".pdf"], can_synthesize: true },
    { kind: "text", label: "Tekstitiedosto", extensions: [".txt", ".md"], can_synthesize: true },
  ]);

  it("reads a slot without required as one the package can do without", () => {
    expect(alternatives.map((s) => s.required)).toEqual([false, false]);
    const readiness = evaluateInputReadiness(alternatives, [
      { name: "invoice.pdf", bytes: 4200, uploaded: true },
    ]);
    expect(readiness.allRequiredPresent).toBe(true);
    expect(readiness.missingRequired).toEqual([]);
    expect(readiness.slots.map((s) => s.satisfied)).toEqual([true, false]);
  });

  it("still waits for a slot marked required", () => {
    const mixed = normalizeExpectedInputs([
      { kind: "audio", label: "Äänite", extensions: [".mp3"], required: true },
      { kind: "document", label: "Asiakirja", extensions: [".pdf"] },
    ]);
    const onlyPdf = evaluateInputReadiness(mixed, [{ name: "agenda.pdf", bytes: 10, uploaded: true }]);
    expect(onlyPdf.allRequiredPresent).toBe(false);
    expect(onlyPdf.missingRequired.map((s) => s.kind)).toEqual(["audio"]);
    const onlyMp3 = evaluateInputReadiness(mixed, [{ name: "meeting.mp3", bytes: 10, uploaded: true }]);
    expect(onlyMp3.allRequiredPresent).toBe(true);
  });

  it("tells a slot filled by the wizard's example alone", () => {
    const readiness = evaluateInputReadiness(hybrid, [
      { name: "meeting.mp3", bytes: 12000, uploaded: true },
      { name: "example_document.pdf", bytes: 4200, uploaded: false },
    ]);
    expect(readiness.slots.map((s) => s.exampleOnly)).toEqual([false, true]);
    const own = evaluateInputReadiness(hybrid, [
      { name: "example_document.pdf", bytes: 4200, uploaded: false },
      { name: "minutes.pdf", bytes: 4200, uploaded: true },
    ]);
    expect(own.slots[1].exampleOnly).toBe(false);
  });
});

describe("formatPocUploadError", () => {
  it("localizes input_type_not_accepted into Finnish with accepted types", () => {
    const msg = formatPocUploadError(
      415,
      { detail: { error: "input_type_not_accepted", message: "this file type is not accepted here; accepted types: PDF, MP3" } },
      fi,
      [{ label: "PDF", extensions: [".pdf"] }, { label: "MP3", extensions: [".mp3"] }],
      "Tiedoston lisäys epäonnistui",
    );
    expect(msg).toContain("Hyväksytyt tiedostotyypit");
    expect(msg).toContain("PDF");
    expect(msg).toContain("MP3");
  });

  it("localizes 413 input_too_large into English", () => {
    const msg = formatPocUploadError(
      413,
      { detail: { error: "input_too_large", message: "file too large" } },
      en,
      [],
      "Upload failed",
    );
    expect(msg).toContain("too large");
  });

  it("words an input_rejected refusal from its code, not from the English message", () => {
    const refused = (code: string | undefined, message: string, locale = en) =>
      formatPocUploadError(
        422,
        { detail: { error: "input_rejected", message, ...(code === undefined ? {} : { reason: code }) } },
        locale,
        [],
        "Upload failed",
      );
    // The message is English text for the log: a different one changes nothing.
    expect(refused("name", "anything at all")).toBe(en.pocUploadRejected.name);
    expect(refused("name", "'../run_poc.py' tries to leave the input directory")).toBe(
      en.pocUploadRejected.name,
    );
    expect(refused("empty", "the file is empty")).toBe("The file is empty.");
    expect(refused("storage", "sample_input resolves outside the PoC package")).toBe(
      en.pocUploadRejected.storage,
    );
    expect(refused("unreadable", "the JSON file is not valid JSON")).toBe(
      en.pocUploadRejected.unreadable,
    );
    expect(refused("unreadable", "a TXT file must be UTF-8 text")).toContain("could not be read");
    expect(refused("too_large", "the file is larger than 50 MB")).toContain("MB");
    expect(refused("empty", "the file is empty", fi)).toBe("Tiedosto on tyhjä.");
    expect(refused("name", "x", fi)).toBe(fi.pocUploadRejected.name);
  });

  it("names a refusal with no known code, or an older api's, generically and in the page's language", () => {
    const legacy = {
      detail: { error: "input_rejected", message: "the JSON file is not valid JSON" },
    };
    expect(formatPocUploadError(422, legacy, en, [], "Upload failed")).toBe(en.pocUploadRejected.other);
    expect(formatPocUploadError(422, legacy, fi, [], "Tiedoston lisäys epäonnistui")).toBe(
      fi.pocUploadRejected.other,
    );
    const unknown = { detail: { error: "input_rejected", reason: "something_new", message: "x" } };
    expect(formatPocUploadError(422, unknown, en, [], "Upload failed")).toBe(en.pocUploadRejected.other);
  });

  it("says the sample and the package states in the page's language", () => {
    const sample = { detail: { error: "sample_not_supported", message: "audio" } };
    expect(formatPocUploadError(422, sample, en, [], "f")).toBe(en.pocUploadSampleNotSupported);
    expect(formatPocUploadError(422, sample, fi, [], "f")).toBe(fi.pocUploadSampleNotSupported);
    expect(formatPocUploadError(404, {}, fi, [], "f")).toBe(fi.pocUploadNotFound);
    expect(formatPocUploadError(409, {}, en, [], "f")).toBe(en.pocUploadNoPackage);
  });
});

describe("explainRunInputError", () => {
  it("explains missing PDF when only MP3 is in sample_input (Finnish)", () => {
    const raw =
      "ERROR: no input with ['.pdf', '.docx', '.doc', '.jpg'] under sample_input (subfolders included); files there: ['webinar_in_finnish_audio_1min.mp3']";
    const hint = explainRunInputError(raw, fi);
    expect(hint).toContain("asiakirja");
    expect(hint).toContain(".pdf");
    expect(hint).toContain("webinar_in_finnish_audio_1min.mp3");
  });

  it("explains empty sample_input for audio (English)", () => {
    const raw =
      "ERROR: no input with ['.wav', '.mp3', '.m4a'] under sample_input (subfolders included); files there: []";
    const hint = explainRunInputError(raw, en);
    expect(hint).toContain("audio file");
    expect(hint).toContain(".mp3");
  });

  it("returns null for unrelated runtime errors", () => {
    expect(explainRunInputError("ValueError: invalid API key", fi)).toBeNull();
  });
});

describe("keyPackageFiles & isAlwaysReadOnlyPackagePath", () => {
  it("picks README, run_poc, config, prompt and schema in order", () => {
    const picked = keyPackageFiles(
      [
        "poc/AI-GENERATED.json",
        "poc/README.md",
        "poc/config.yaml",
        "poc/prompts/extraction_requirements.md",
        "poc/run_poc.py",
        "poc/schemas/output_schema.py",
        "poc/ui/index.html",
      ],
      fi,
    );
    expect(picked.map((f) => f.pocPath)).toEqual([
      "README.md",
      "run_poc.py",
      "config.yaml",
      "prompts/extraction_requirements.md",
      "schemas/output_schema.py",
    ]);
    expect(picked.map((f) => f.role)).toEqual([
      "Käyttöohje",
      "Pääohjelma",
      "Malliasetukset",
      "Mallin ohjeet",
      "Tietomalli",
    ]);
    expect(keyPackageFiles(["poc/README.md"], en)[0].role).toBe("Guide");
  });

  it("flags generated test page and AI marker as always read-only", () => {
    expect(isAlwaysReadOnlyPackagePath("poc/app.py")).toBe(true);
    expect(isAlwaysReadOnlyPackagePath("poc/ui/index.html")).toBe(true);
    expect(isAlwaysReadOnlyPackagePath("poc/AI-GENERATED.json")).toBe(true);
    expect(isAlwaysReadOnlyPackagePath("poc/README.md")).toBe(false);
    expect(isAlwaysReadOnlyPackagePath("poc/prompts/extraction_requirements.md")).toBe(false);
  });
});
