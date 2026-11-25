import { describe, expect, it } from "vitest";
import {
  evaluateInputReadiness,
  explainRunInputError,
  formatPocUploadError,
  isAlwaysReadOnlyPackagePath,
  keyPackageFiles,
  normalizeExpectedInputs,
} from "./poc-input-readiness";

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
});

describe("formatPocUploadError", () => {
  it("localizes input_type_not_accepted into Finnish with accepted types", () => {
    const msg = formatPocUploadError(
      415,
      { detail: { error: "input_type_not_accepted", message: "this file type is not accepted here; accepted types: PDF, MP3" } },
      "fi",
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
      "en",
      [],
      "Upload failed",
    );
    expect(msg).toContain("too large");
  });

  it("says which input_rejected refusal it was", () => {
    const rejected = (message: string) =>
      formatPocUploadError(422, { detail: { error: "input_rejected", message } }, "en", [], "Upload failed");
    expect(rejected("the file is empty")).toBe("The file is empty.");
    expect(rejected("the file is larger than 50 MB")).toContain("50 MB");
    expect(rejected("the file name is too long")).toContain("Rename the file");
    expect(rejected("'../run_poc.py' tries to leave the input directory")).toContain("Rename the file");
  });
});

describe("explainRunInputError", () => {
  it("explains missing PDF when only MP3 is in sample_input (Finnish)", () => {
    const raw =
      "ERROR: no input with ['.pdf', '.docx', '.doc', '.jpg'] under sample_input (subfolders included); files there: ['webinar_in_finnish_audio_1min.mp3']";
    const hint = explainRunInputError(raw, "fi");
    expect(hint).toContain("asiakirja");
    expect(hint).toContain(".pdf");
    expect(hint).toContain("webinar_in_finnish_audio_1min.mp3");
  });

  it("explains empty sample_input for audio (English)", () => {
    const raw =
      "ERROR: no input with ['.wav', '.mp3', '.m4a'] under sample_input (subfolders included); files there: []";
    const hint = explainRunInputError(raw, "en");
    expect(hint).toContain("audio file");
    expect(hint).toContain(".mp3");
  });

  it("returns null for unrelated runtime errors", () => {
    expect(explainRunInputError("ValueError: invalid API key", "fi")).toBeNull();
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
      "fi",
    );
    expect(picked.map((f) => f.pocPath)).toEqual([
      "README.md",
      "run_poc.py",
      "config.yaml",
      "prompts/extraction_requirements.md",
      "schemas/output_schema.py",
    ]);
  });

  it("flags generated test page and AI marker as always read-only", () => {
    expect(isAlwaysReadOnlyPackagePath("poc/app.py")).toBe(true);
    expect(isAlwaysReadOnlyPackagePath("poc/ui/index.html")).toBe(true);
    expect(isAlwaysReadOnlyPackagePath("poc/AI-GENERATED.json")).toBe(true);
    expect(isAlwaysReadOnlyPackagePath("poc/README.md")).toBe(false);
    expect(isAlwaysReadOnlyPackagePath("poc/prompts/extraction_requirements.md")).toBe(false);
  });
});
