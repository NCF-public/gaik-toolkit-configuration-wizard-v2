import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session-access", () => ({
  requireOwnedSession: vi.fn(async () => ({ user: { email: "dev@gaik.local" } })),
}));
vi.mock("@/lib/wizard-api-client", () => ({
  wizardApiEnabled: vi.fn(() => true),
  apiCases: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n")>();
  return { ...actual, getI18n: async () => ({ locale: "en", t: actual.dictionary("en") }) };
});

import { GET, POST } from "@/app/api/sessions/[id]/cases/[[...path]]/route";
import { dictionary } from "@/lib/i18n";
import { apiCases } from "@/lib/wizard-api-client";

const TRACE = "trace-cases-001";
const CASE = "0f8fad5b-d9cb-469f-a165-70867728950e";

function call(method: "GET" | "POST", path: string[], body?: unknown) {
  const req = new NextRequest(`http://localhost/api/sessions/s1/cases/${path.join("/")}`, {
    method,
    headers: { "x-trace-id": TRACE, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const handler = method === "GET" ? GET : POST;
  return handler(req, { params: Promise.resolve({ id: "s1", path }) });
}

describe("cases relay", () => {
  beforeEach(() => {
    vi.mocked(apiCases).mockReset();
  });

  it("relays a case unchanged", async () => {
    vi.mocked(apiCases).mockResolvedValue(Response.json({ id: CASE, status: "draft" }));
    const res = await call("GET", [CASE]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: CASE, status: "draft" });
  });

  it("keeps a review refused for a missing required field", async () => {
    const detail = { error: "case_state", message: "invoice_number is required", trace_id: TRACE };
    vi.mocked(apiCases).mockResolvedValue(Response.json({ detail }, { status: 409 }));
    const res = await call("POST", [CASE, "review"], { action: "approve" });
    expect(res.status).toBe(409);
    expect((await res.json()).detail).toEqual(detail);
  });

  it("turns a BPMN parser error with a server path into the generic message", async () => {
    vi.mocked(apiCases).mockResolvedValue(
      Response.json(
        { detail: "workflow.bpmn does not parse: /srv/wizard/out/abc/workflow.bpmn line 3, column 1" },
        { status: 409 },
      ),
    );
    const res = await call("GET", ["model"]);
    const text = await res.text();
    expect(res.status).toBe(409);
    expect(text).not.toContain("/srv/wizard");
    expect(JSON.parse(text).detail.message).toBe(dictionary("en").errorGeneric.replace("{trace}", TRACE));
  });
});
