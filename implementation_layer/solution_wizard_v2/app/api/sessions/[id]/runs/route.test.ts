import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session-access", () => ({
  requireOwnedSession: vi.fn(async () => ({ user: { email: "dev@example.org" } })),
}));
vi.mock("@/lib/wizard-api-client", () => ({
  wizardAgentChatEnabled: vi.fn(() => true),
  apiCreatePocRun: vi.fn(),
  apiCreatePocCheck: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { POST as postRun } from "@/app/api/sessions/[id]/runs/route";
import { POST as postCheck } from "@/app/api/sessions/[id]/poc/check/route";
import { apiCreatePocCheck, apiCreatePocRun } from "@/lib/wizard-api-client";

const ctx = { params: Promise.resolve({ id: "s1" }) };
const busy = () =>
  Response.json(
    { detail: { error: "sandbox_busy", message: "the sandbox is busy; try again in a minute" } },
    { status: 429, headers: { "Retry-After": "30" } },
  );

describe("run and preflight relays", () => {
  beforeEach(() => {
    vi.mocked(apiCreatePocRun).mockReset();
    vi.mocked(apiCreatePocCheck).mockReset();
  });

  it("passes a busy run on with its Retry-After", async () => {
    vi.mocked(apiCreatePocRun).mockResolvedValue(busy());
    const res = await postRun(new NextRequest("http://localhost/api/sessions/s1/runs", { method: "POST" }), ctx);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect((await res.json()).detail.error).toBe("sandbox_busy");
  });

  it("passes a busy preflight on with its Retry-After", async () => {
    vi.mocked(apiCreatePocCheck).mockResolvedValue(busy());
    const res = await postCheck(
      new NextRequest("http://localhost/api/sessions/s1/poc/check", { method: "POST" }),
      ctx,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("adds no Retry-After to an answer that had none", async () => {
    vi.mocked(apiCreatePocCheck).mockResolvedValue(
      Response.json({ run_id: "r1-chk", phase: "pending" }, { status: 201 }),
    );
    const res = await postCheck(
      new NextRequest("http://localhost/api/sessions/s1/poc/check", { method: "POST" }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("retry-after")).toBeNull();
  });
});
