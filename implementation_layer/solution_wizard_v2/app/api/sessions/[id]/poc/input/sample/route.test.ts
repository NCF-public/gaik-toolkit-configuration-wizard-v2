import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session-access", () => ({
  requireOwnedSession: vi.fn(async () => ({ user: { email: "dev@gaik.local" } })),
}));
vi.mock("@/lib/wizard-api-client", () => ({
  wizardApiEnabled: vi.fn(() => true),
  apiCreatePocSampleInput: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n")>();
  return { ...actual, getI18n: async () => ({ locale: "en", t: actual.dictionary("en") }) };
});

import { POST } from "@/app/api/sessions/[id]/poc/input/sample/route";
import { apiCreatePocSampleInput } from "@/lib/wizard-api-client";
import { dictionary } from "@/lib/i18n";
import { formatPocUploadError } from "@/lib/poc-input-readiness";

function create(body: unknown) {
  const req = new NextRequest("http://localhost/api/sessions/s1/poc/input/sample", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: "s1" }) });
}

describe("PoC sample input relay", () => {
  beforeEach(() => {
    vi.mocked(apiCreatePocSampleInput).mockReset();
  });

  it("passes the slot kind on and relays the created example", async () => {
    vi.mocked(apiCreatePocSampleInput).mockResolvedValue(
      Response.json({ name: "example_document.pdf", bytes: 900, uploaded: false }, { status: 201 }),
    );
    const res = await create({ kind: " Document " });
    expect(apiCreatePocSampleInput).toHaveBeenCalledWith("s1", "Document");
    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe("example_document.pdf");
  });

  it("keeps the api's sample_not_supported code, so the tab can say what to do", async () => {
    vi.mocked(apiCreatePocSampleInput).mockResolvedValue(
      Response.json(
        { detail: { error: "sample_not_supported", message: "not for audio" } },
        { status: 422 },
      ),
    );
    const res = await create({ kind: "audio" });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.detail.error).toBe("sample_not_supported");
    expect(formatPocUploadError(422, body, dictionary("en"), [], "fallback")).toContain("cannot be generated");
  });
});
