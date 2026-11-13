import { describe, expect, it } from "vitest";
import {
  formatValue,
  groundingFlags,
  pairLine,
  recordsLayout,
  valueText,
  type ShownValue,
} from "@/lib/case-value";

const en = { yes: "Yes", no: "No" };
const fi = { yes: "Kyllä", no: "Ei" };
const text = (t: string): ShownValue => ({ kind: "text", text: t });
const empty: ShownValue = { kind: "empty" };

describe("formatValue", () => {
  it("shows nothing as a dash: null, blank text, an empty list, an empty object", () => {
    for (const nothing of [null, undefined, "", "  ", [], {}, [null, ""], "[]", "{}"]) {
      expect(formatValue(nothing, en)).toEqual(empty);
      expect(valueText(formatValue(nothing, en))).toBe("—");
    }
  });

  it("says a boolean in the page's language and leaves a number as it is", () => {
    expect(formatValue(true, en)).toEqual(text("Yes"));
    expect(formatValue(false, fi)).toEqual(text("Ei"));
    expect(formatValue(0, en)).toEqual(text("0"));
    expect(formatValue(12.5, en)).toEqual(text("12.5"));
    expect(formatValue("true", en)).toEqual(text("true"));
  });

  it("reads a list of plain values as lines, without brackets or quotes", () => {
    const shown = formatValue(["Go to the Reports page.", "Click Export next to Print.", true, 3], en);
    expect(shown).toEqual({
      kind: "list",
      items: ["Go to the Reports page.", "Click Export next to Print.", "Yes", "3"],
    });
    expect(valueText(shown)).not.toMatch(/[[\]"]/);
  });

  it("reads an object as label and value lines", () => {
    const shown = formatValue({ page_title: "Reports", needsReview: false, tags: [] }, en);
    expect(shown).toEqual({
      kind: "pairs",
      pairs: [
        { label: "Page title", value: text("Reports") },
        { label: "Needs review", value: text("No") },
        { label: "Tags", value: empty },
      ],
    });
    expect(valueText(shown)).toBe("Page title: Reports\nNeeds review: No\nTags: —");
  });

  it("reads a list of objects as records under the columns they share", () => {
    const shown = formatValue(
      [
        { name: "Export", steps: ["Open Reports.", "Click Export."] },
        { name: "Print", breaking: true },
      ],
      en,
    );
    expect(shown).toEqual({
      kind: "records",
      columns: ["Name", "Steps", "Breaking"],
      rows: [
        [
          { label: "Name", value: text("Export") },
          { label: "Steps", value: { kind: "list", items: ["Open Reports.", "Click Export."] } },
          { label: "Breaking", value: empty },
        ],
        [
          { label: "Name", value: text("Print") },
          { label: "Steps", value: empty },
          { label: "Breaking", value: text("Yes") },
        ],
      ],
    });
    expect(valueText(shown)).toBe(
      "Name: Export\nSteps:\n  Open Reports.\n  Click Export.\nBreaking: —\n\nName: Print\nSteps: —\nBreaking: Yes",
    );
  });

  it("reads text that is a JSON list as the list", () => {
    expect(formatValue('["a","b"]', en)).toEqual({ kind: "list", items: ["a", "b"] });
    // Brackets alone do not make it JSON.
    expect(formatValue("[draft]", en)).toEqual(text("[draft]"));
  });

  it("keeps a shape it cannot read as JSON for the disclosure, not as text", () => {
    const mixed = formatValue([1, { a: 1 }], en);
    expect(mixed.kind).toBe("raw");
    const deep = formatValue([{ a: { b: { c: [1] } } }], en);
    expect(deep).toMatchObject({
      kind: "records",
      rows: [[{ label: "A", value: { kind: "pairs", pairs: [{ label: "B", value: { kind: "raw" } }] } }]],
    });
  });
});

describe("pairLine", () => {
  it("hangs a value of several lines under its label", () => {
    expect(pairLine({ label: "Steps", value: { kind: "list", items: ["One", "Two"] } })).toBe("Steps:\n  One\n  Two");
    expect(pairLine({ label: "Name", value: text("Export") })).toBe("Name: Export");
  });
});

describe("recordsLayout", () => {
  const records = (rows: Record<string, unknown>[]) =>
    formatValue(rows, en) as Extract<ShownValue, { kind: "records" }>;

  it("keeps a table for few, short fields", () => {
    expect(recordsLayout(records([{ code: "A1", qty: 2, unit: "pcs", ok: true }]))).toBe("table");
    expect(recordsLayout(records([{ name: "Export", tags: ["pdf", "csv"] }]))).toBe("table");
  });

  it("lays records out as pairs when they have more than four fields", () => {
    expect(recordsLayout(records([{ a: 1, b: 2, c: 3, d: 4, e: 5 }]))).toBe("pairs");
    // The fields of all rows count, not of the first one.
    expect(recordsLayout(records([{ a: 1, b: 2, c: 3 }, { d: 4, e: 5 }]))).toBe("pairs");
  });

  it("lays records out as pairs when a value is long", () => {
    expect(recordsLayout(records([{ name: "Export", summary: "x".repeat(80) }]))).toBe("table");
    expect(recordsLayout(records([{ name: "Export", summary: "x".repeat(81) }]))).toBe("pairs");
    const steps = ["Go to the Reports page and open the list.", "Click Export next to Print, then choose a format."];
    expect(recordsLayout(records([{ name: "Export", steps }]))).toBe("pairs");
  });
});

describe("groundingFlags", () => {
  it("names the values a failed check is about", () => {
    const validation = {
      passed: false,
      hallucination_flags: [
        { field: "release_date", value: "2026-12-01", severity: "high", reason: "Not in the source." },
        { field: "line_item.article_code", value: ["A1"], reason: "" },
        "not a flag",
        {},
      ],
    };
    expect(groundingFlags(validation, en)).toEqual([
      { field: "Release date", value: text("2026-12-01"), reason: "Not in the source." },
      { field: "Line item › Article code", value: { kind: "list", items: ["A1"] }, reason: "" },
    ]);
  });

  it("names none when the check only says whether it passed", () => {
    expect(groundingFlags({ passed: false }, en)).toEqual([]);
    expect(groundingFlags(null, en)).toEqual([]);
    expect(groundingFlags({ passed: false, hallucination_flags: "many" }, en)).toEqual([]);
  });
});
