import { describe, expect, it } from "vitest";
import { pathBelowField, sourceTraceIn, sourcesForField, topField } from "./poc-source-trace";

const trace = (sources: unknown[], documents: string[] = []) => ({
  name: "delivery_note_source_trace.json",
  body: JSON.stringify({ summary: {}, documents, sources }),
});

const source = (over: Record<string, unknown>) => ({
  field: "delivery_note_number",
  value: "LH-2026-11873",
  quote: "Lähetenumero: LH-2026-11873",
  document: 1,
  page: 1,
  verdict: "verified",
  record: null,
  ...over,
});

describe("the run's source trace", () => {
  it("is read from the trace file the PoC wrote beside its result", () => {
    const found = sourceTraceIn({
      files: [
        { name: "result.json", body: "{}" },
        trace([source({}), source({ field: "lines[0].quantity", quote: "2000 kpl", verdict: "check" })]),
      ],
    });

    expect(found?.total).toBe(2);
    expect(found?.verified).toBe(1);
    expect(found?.sources[1]).toMatchObject({
      field: "lines[0].quantity",
      quote: "2000 kpl",
      verdict: "check",
      page: null,
      document: null,
    });
  });

  it("is absent when the PoC wrote none, or one that does not read", () => {
    expect(sourceTraceIn({ files: [{ name: "result.json", body: "{}" }] })).toBeNull();
    expect(sourceTraceIn({ files: [{ name: "a_source_trace.json", body: "{not json" }] })).toBeNull();
    expect(sourceTraceIn({ files: [trace([])] })).toBeNull();
  });

  it("names the page and the document only where the run named its documents", () => {
    const pdf = sourceTraceIn({ files: [trace([source({ page: 3 })], ["lahete.pdf"])] });
    const text = sourceTraceIn({ files: [trace([source({ page: 3 })])] });

    expect(pdf?.sources[0]).toMatchObject({ page: 3, document: "lahete.pdf" });
    expect(text?.sources[0]).toMatchObject({ page: null, document: null });
  });

  it("leaves out a citation with no snippet, and reads an unknown verdict as unchecked", () => {
    const found = sourceTraceIn({
      files: [trace([source({ quote: "  " }), source({ verdict: "certain" }), { field: 7 }, "x"])],
    });

    expect(found?.total).toBe(1);
    expect(found?.sources[0].verdict).toBe("unchecked");
  });

  it("joins the traces of several inputs", () => {
    const found = sourceTraceIn({
      files: [
        { name: "a_source_trace.json", body: JSON.stringify({ sources: [source({ record: 0 })] }) },
        { name: "b_source_trace.json", body: JSON.stringify({ sources: [source({ record: 1 })] }) },
      ],
    });

    expect(found?.total).toBe(2);
  });
});

describe("the citations of one field", () => {
  const found = sourceTraceIn({
    files: [
      trace([
        source({}),
        source({ field: "lines[0].quantity", quote: "2000 kpl" }),
        source({ field: "lines[1].quantity", quote: "4000 kpl" }),
        source({ field: "date", quote: "10.11.2026", record: 1 }),
      ]),
    ],
  });

  it("are those whose path starts at the field", () => {
    expect(sourcesForField(found, "lines", 0).map((s) => s.quote)).toEqual(["2000 kpl", "4000 kpl"]);
    expect(sourcesForField(found, "delivery_note_number", 0)).toHaveLength(1);
    expect(sourcesForField(found, "line", 0)).toEqual([]);
  });

  it("belong to their record, and a shared one to every record", () => {
    expect(sourcesForField(found, "date", 0)).toEqual([]);
    expect(sourcesForField(found, "date", 1)).toHaveLength(1);
    expect(sourcesForField(found, "delivery_note_number", 1)).toHaveLength(1);
    expect(sourcesForField(null, "date", 0)).toEqual([]);
  });

  it("name the place below the field for a list's values", () => {
    expect(topField("lines[0].quantity")).toBe("lines");
    expect(pathBelowField("lines[0].quantity")).toBe("[0].quantity");
    expect(pathBelowField("supplier.name")).toBe("name");
    expect(pathBelowField("date")).toBe("");
  });
});
