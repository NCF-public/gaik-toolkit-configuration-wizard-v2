import { describe, expect, it } from "vitest";
import {
  bpmnDrawnIds,
  hasLayoutTargets,
  resetBodies,
  resetStoredLayout,
} from "./bpmn-layout-reset";

const drawing = (shapes: string[], edges: string[]) =>
  `<bpmn:definitions><bpmndi:BPMNDiagram><bpmndi:BPMNPlane>` +
  shapes
    .map(
      (id) =>
        `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><omgdc:Bounds x="1" y="2"/></bpmndi:BPMNShape>`,
    )
    .join("") +
  edges
    .map(
      (id) =>
        `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}"><omgdi:waypoint x="1" y="2"/></bpmndi:BPMNEdge>`,
    )
    .join("") +
  `</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;

describe("bpmnDrawnIds", () => {
  it("lists the shapes and edges a drawing has, once each", () => {
    const xml = drawing(["A", "B", "A"], ["F1"]);
    expect(bpmnDrawnIds(xml)).toEqual({ shapes: ["A", "B"], edges: ["F1"] });
    expect(hasLayoutTargets(xml)).toBe(true);
    expect(hasLayoutTargets("<bpmn:definitions/>")).toBe(false);
  });
  it("leaves out an id the server would refuse", () => {
    expect(
      bpmnDrawnIds(drawing(["ok_1", "bad id", "x".repeat(101)], [])).shapes,
    ).toEqual(["ok_1"]);
  });
});

describe("resetBodies", () => {
  it("splits a large diagram into requests of at most 300 entries", () => {
    const shapes = Array.from({ length: 250 }, (_, i) => `S${i}`);
    const edges = Array.from({ length: 100 }, (_, i) => `E${i}`);
    const bodies = resetBodies(shapes, edges);
    expect(
      bodies.map(
        (b) => Object.keys(b.shapes).length + Object.keys(b.edges).length,
      ),
    ).toEqual([300, 50]);
    expect(Object.values(bodies[0].shapes).every((v) => v === null)).toBe(true);
  });
});

describe("resetStoredLayout", () => {
  it("clears the shapes and edges of both drawings in both modes", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const send = async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (!init?.method) {
        // The drawing with data objects has a data object the compact one lacks.
        const full = !url.includes("data_objects=0");
        return new Response(
          drawing(
            full ? ["A", "Data_1"] : ["A"],
            full ? ["F1", "Assoc_1"] : ["F1"],
          ),
          { status: 200 },
        );
      }
      return new Response(null, { status: 204 });
    };
    await resetStoredLayout("ses_1", send);
    const reads = calls.filter((c) => c.method === "GET").map((c) => c.url);
    expect(reads).toEqual([
      "/api/sessions/ses_1/bpmn",
      "/api/sessions/ses_1/bpmn?data_objects=0",
    ]);
    const writes = calls.filter((c) => c.method === "PUT");
    expect(writes.map((c) => c.url)).toEqual([
      "/api/sessions/ses_1/bpmn/layout?data_objects=0",
      "/api/sessions/ses_1/bpmn/layout?data_objects=1",
    ]);
    for (const w of writes) {
      expect(w.body).toEqual({
        shapes: { A: null, Data_1: null },
        edges: { F1: null, Assoc_1: null },
      });
    }
  });

  it("throws when a write is refused", async () => {
    const send = async (_url: string, init?: RequestInit) =>
      init?.method
        ? new Response(null, { status: 500 })
        : new Response(drawing(["A"], []), { status: 200 });
    await expect(resetStoredLayout("ses_1", send)).rejects.toThrow(
      "layout 500",
    );
  });

  it("throws when a drawing cannot be read, and writes nothing", async () => {
    const calls: string[] = [];
    const send = async (url: string) => {
      calls.push(url);
      return new Response("", { status: 503 });
    };
    await expect(resetStoredLayout("ses_1", send)).rejects.toThrow("bpmn 503");
    expect(calls).toHaveLength(1);
  });
});
