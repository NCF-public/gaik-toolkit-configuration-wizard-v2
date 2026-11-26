/**
 * "Reset layout" on the BPMN canvas: drops the places the user gave shapes and
 * flows (`PUT /bpmn/layout`, `null` for an id) in both drawing modes, so the
 * diagram is drawn as generated. The client cannot read the stored layout, so
 * it clears every shape and edge of both drawings; an entry kept for an id
 * neither drawing has any more is not seen, and the server ignores it anyway.
 */

import { bpmnDataObjectsQuery } from "@/lib/bpmn-show-data";

type Send = (url: string, init?: RequestInit) => Promise<Response>;

/** wizard_api's id rule: one other id would refuse the whole request. */
const SERVER_ID = /^[A-Za-z0-9_.-]{1,100}$/;
/** Entries a request carries, so a large diagram stays under the route's body bound. */
const CHUNK = 300;

/** The ids of the shapes and edges a BPMN diagram draws (its `BPMNShape` and `BPMNEdge` elements). */
export function bpmnDrawnIds(xml: string): {
  shapes: string[];
  edges: string[];
} {
  const ids = (element: "BPMNShape" | "BPMNEdge") => {
    const found = new Set<string>();
    const tag = new RegExp(`<(?:[\\w.-]+:)?${element}\\b[^>]*>`, "g");
    for (const [open] of xml.matchAll(tag)) {
      const id = /\bbpmnElement="([^"]*)"/.exec(open)?.[1];
      if (id && SERVER_ID.test(id)) found.add(id);
    }
    return [...found];
  };
  return { shapes: ids("BPMNShape"), edges: ids("BPMNEdge") };
}

/** The bodies of the requests that clear `shapes` and `edges`, a few hundred entries each. */
export function resetBodies(
  shapes: string[],
  edges: string[],
): { shapes: Record<string, null>; edges: Record<string, null> }[] {
  const entries = [
    ...shapes.map((id) => ["shapes", id] as const),
    ...edges.map((id) => ["edges", id] as const),
  ];
  const bodies: {
    shapes: Record<string, null>;
    edges: Record<string, null>;
  }[] = [];
  for (let i = 0; i < entries.length; i += CHUNK) {
    const body = {
      shapes: {} as Record<string, null>,
      edges: {} as Record<string, null>,
    };
    for (const [section, id] of entries.slice(i, i + CHUNK))
      body[section][id] = null;
    bodies.push(body);
  }
  return bodies;
}

/** Whether a drawing has anything a kept place could belong to. */
export function hasLayoutTargets(xml: string): boolean {
  const { shapes, edges } = bpmnDrawnIds(xml);
  return shapes.length + edges.length > 0;
}

/**
 * Reads the drawing of each mode, then clears every shape and edge of either
 * in both modes. Throws when a read or a write is refused; some of the writes
 * may have gone through by then, which a repeated reset finishes.
 */
export async function resetStoredLayout(
  sessionId: string,
  send: Send = (url, init) => fetch(url, init),
): Promise<void> {
  const base = `/api/sessions/${sessionId}/bpmn`;
  const shapes = new Set<string>();
  const edges = new Set<string>();
  for (const show of [true, false]) {
    const res = await send(`${base}${bpmnDataObjectsQuery(show)}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`bpmn ${res.status}`);
    const drawn = bpmnDrawnIds(await res.text());
    drawn.shapes.forEach((id) => shapes.add(id));
    drawn.edges.forEach((id) => edges.add(id));
  }
  const bodies = resetBodies([...shapes], [...edges]);
  for (const mode of [0, 1]) {
    for (const body of bodies) {
      const res = await send(`${base}/layout?data_objects=${mode}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`layout ${res.status}`);
    }
  }
}
