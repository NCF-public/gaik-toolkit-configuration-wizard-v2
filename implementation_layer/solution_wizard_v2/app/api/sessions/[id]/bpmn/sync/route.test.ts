import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Collaborators are mocked so the test exercises the route's own decisions:
// the size cap before anything is spawned, and that a normal document still
// reaches the linter and the sync.
vi.mock("@/lib/session-access", () => ({
  requireOwnedSession: vi.fn(async () => ({
    user: { email: "dev@gaik.local" },
    session: { step: 10, blueprint: { name: "b", steps: [] } },
  })),
}));
vi.mock("@/lib/bpmn-spike", () => ({
  BPMN_VISUAL_STEP: 5,
  hasBpmnSpike: vi.fn(() => true),
}));
vi.mock("@/lib/bpmn-lint", () => ({
  BPMN_XML_MAX_BYTES: 1024,
  BpmnLintBusyError: class BpmnLintBusyError extends Error {},
  lintBpmnXml: vi.fn(async () => ({ ok: true, errors: [], warnings: [], issues: [] })),
}));
vi.mock("@/lib/bpmn-generate", () => ({
  syncSessionBpmn: vi.fn(async (_id: string, blueprint: unknown, xml: string) => ({
    blueprint,
    xml,
  })),
}));
vi.mock("@/lib/sessions", () => ({
  saveBlueprintAfterBpmnSync: vi.fn(async () => undefined),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { POST } from "@/app/api/sessions/[id]/bpmn/sync/route";
import { lintBpmnXml } from "@/lib/bpmn-lint";
import { syncSessionBpmn } from "@/lib/bpmn-generate";

function post(xml: string, headers: Record<string, string> = {}) {
  const body = JSON.stringify({ xml });
  // A browser's fetch always says the length of a string body.
  const req = new NextRequest("http://localhost/api/sessions/s1/bpmn/sync", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body, "utf8")),
      ...headers,
    },
    body,
  });
  return POST(req, { params: Promise.resolve({ id: "s1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /sessions/[id]/bpmn/sync — size cap (T3)", () => {
  it("refuses a document over the limit before the linter is spawned", async () => {
    const res = await post("<bpmn>" + "x".repeat(2000) + "</bpmn>");
    expect(res.status).toBe(413);
    expect(await res.text()).toMatch(/too large/);
    expect(lintBpmnXml).not.toHaveBeenCalled();
    expect(syncSessionBpmn).not.toHaveBeenCalled();
  });

  it("refuses on the declared content length alone, without reading the body", async () => {
    const res = await post("<bpmn/>", { "content-length": String(10 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(lintBpmnXml).not.toHaveBeenCalled();
  });

  it("refuses a body that does not say its length, before reading it", async () => {
    const req = new NextRequest("http://localhost/api/sessions/s1/bpmn/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ xml: "<bpmn/>" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(411);
    expect(lintBpmnXml).not.toHaveBeenCalled();
  });

  it("lints and syncs a document within the limit", async () => {
    const res = await post("<bpmn:definitions/>");
    expect(res.status).toBe(200);
    expect(lintBpmnXml).toHaveBeenCalledTimes(1);
    expect(syncSessionBpmn).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { lint: { ok: boolean } };
    expect(body.lint.ok).toBe(true);
  });

  it("asks to retry, and saves nothing, when the linter is busy", async () => {
    const { BpmnLintBusyError } = await import("@/lib/bpmn-lint");
    vi.mocked(lintBpmnXml).mockRejectedValueOnce(new BpmnLintBusyError());
    const res = await post("<bpmn:definitions/>");
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("2");
    expect(syncSessionBpmn).not.toHaveBeenCalled();
  });
});
