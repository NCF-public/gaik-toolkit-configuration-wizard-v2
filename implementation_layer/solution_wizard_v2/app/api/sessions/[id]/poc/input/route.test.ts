import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session-access", () => ({
  requireOwnedSession: vi.fn(async () => ({ user: { email: "dev@gaik.local" } })),
}));
vi.mock("@/lib/wizard-api-client", () => ({
  wizardApiEnabled: vi.fn(() => true),
  apiListPocInputs: vi.fn(),
  apiUploadPocInput: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n")>();
  return { ...actual, getI18n: async () => ({ locale: "en", t: actual.dictionary("en") }) };
});

import { GET, POST } from "@/app/api/sessions/[id]/poc/input/route";
import { apiListPocInputs, apiUploadPocInput } from "@/lib/wizard-api-client";

const TRACE = "trace-input-001";

async function upload() {
  const form = new FormData();
  form.append("file", new File(["hello"], "invoice.pdf"), "invoice.pdf");
  // Encoded up front: the route refuses a body that does not say its length.
  const encoded = new Response(form);
  const body = await encoded.arrayBuffer();
  const req = new NextRequest("http://localhost/api/sessions/s1/poc/input", {
    method: "POST",
    headers: {
      "x-trace-id": TRACE,
      "content-type": encoded.headers.get("content-type") ?? "",
      "content-length": String(body.byteLength),
    },
    body,
  });
  return POST(req, { params: Promise.resolve({ id: "s1" }) });
}

describe("PoC input list relay", () => {
  beforeEach(() => {
    vi.mocked(apiListPocInputs).mockReset();
  });

  it("relays files, expected_inputs and accepted_inputs from wizard_api", async () => {
    vi.mocked(apiListPocInputs).mockResolvedValue({
      files: [{ name: "a.mp3", bytes: 1200, uploaded: true }],
      expected_inputs: [{ kind: "audio", label: "Äänite", extensions: [".mp3"], can_synthesize: false }],
      accepted_inputs: [{ kind: "mp3", label: "MP3", extensions: [".mp3"] }],
    });
    const res = await GET(new NextRequest("http://localhost/api/sessions/s1/poc/input"), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(body.expected_inputs).toHaveLength(1);
    expect(body.accepted_inputs).toHaveLength(1);
  });

  it("returns 502 instead of an empty 200 list when wizard_api is unreachable", async () => {
    vi.mocked(apiListPocInputs).mockRejectedValue(new Error("connect ECONNREFUSED"));
    const res = await GET(new NextRequest("http://localhost/api/sessions/s1/poc/input"), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(502);
  });
});

describe("PoC input upload relay", () => {
  beforeEach(() => {
    vi.mocked(apiUploadPocInput).mockReset();
  });

  it("keeps the reason a file was refused", async () => {
    const detail = { error: "input_rejected", message: "'..' tries to leave the input directory", trace_id: TRACE };
    vi.mocked(apiUploadPocInput).mockResolvedValue(Response.json({ detail }, { status: 422 }));
    const res = await upload();
    expect(res.status).toBe(422);
    expect((await res.json()).detail).toEqual(detail);
  });

  it("turns an OS error with a server path into the generic message", async () => {
    vi.mocked(apiUploadPocInput).mockResolvedValue(
      Response.json(
        { detail: "OSError: [Errno 28] No space left on device: '/srv/wizard/out/abc/poc/sample_input'" },
        { status: 500 },
      ),
    );
    const res = await upload();
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("/srv/wizard");
    expect(JSON.parse(text).detail).toMatchObject({ error: "internal_error", trace_id: TRACE });
  });
});

describe("PoC input upload during a maintenance break", () => {
  beforeEach(() => {
    vi.mocked(apiUploadPocInput).mockReset();
    vi.mocked(apiListPocInputs).mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses the upload before it reaches wizard_api, which the proxy cannot do here", async () => {
    vi.stubEnv("WIZARD_MAINTENANCE", "on");
    const res = await upload();
    expect(res.status).toBe(503);
    expect(res.headers.get("x-wizard-maintenance")).toBe("on");
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(apiUploadPocInput).not.toHaveBeenCalled();
  });

  it("lets an address on the maintenance list through", async () => {
    vi.stubEnv("WIZARD_MAINTENANCE", "on");
    vi.stubEnv("WIZARD_MAINTENANCE_ALLOW", "ops@gaik.local, Dev@gaik.local");
    vi.mocked(apiListPocInputs).mockResolvedValue({ files: [], expected_inputs: [], accepted_inputs: [] });
    const res = await GET(new NextRequest("http://localhost/api/sessions/s1/poc/input"), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(200);
  });
});
