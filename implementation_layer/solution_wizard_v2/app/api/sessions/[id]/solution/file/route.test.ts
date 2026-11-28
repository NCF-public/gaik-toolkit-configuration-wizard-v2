import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session-access", () => ({
  requireOwnedSession: vi.fn(async () => ({ user: { email: "dev@gaik.local" }, session: {} })),
}));
vi.mock("@/lib/wizard-api-client", () => ({
  wizardApiEnabled: vi.fn(() => true),
  apiGetSolutionFile: vi.fn(),
}));

import { GET } from "@/app/api/sessions/[id]/solution/file/route";
import { requireOwnedSession } from "@/lib/session-access";
import { apiGetSolutionFile, wizardApiEnabled } from "@/lib/wizard-api-client";

const params = { params: Promise.resolve({ id: "s1" }) };
const get = (path: string | null) =>
  GET(
    new NextRequest(
      `http://localhost/api/sessions/s1/solution/file${path === null ? "" : `?path=${encodeURIComponent(path)}`}`,
      { headers: { "x-trace-id": "trace-solution-0001" } },
    ),
    params,
  );

describe("solution file relay", () => {
  beforeEach(() => {
    vi.mocked(apiGetSolutionFile).mockReset();
    vi.mocked(wizardApiEnabled).mockReturnValue(true);
    vi.mocked(requireOwnedSession).mockResolvedValue({
      user: { email: "dev@gaik.local" },
      session: {},
    } as Awaited<ReturnType<typeof requireOwnedSession>>);
  });

  it("answers 404 for a session that is not the caller's, without asking the api", async () => {
    vi.mocked(requireOwnedSession).mockResolvedValue(null);

    expect((await get("docs/user_guide.md")).status).toBe(404);
    expect(apiGetSolutionFile).not.toHaveBeenCalled();
  });

  it("relays a document as the api answered it, uncached", async () => {
    vi.mocked(apiGetSolutionFile).mockResolvedValue(
      Response.json({ path: "docs/user_guide.md", content: "# User guide\n", digest: "d1", editable: false }),
    );

    const res = await get("docs/user_guide.md");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ content: "# User guide\n", editable: false });
    expect(apiGetSolutionFile).toHaveBeenCalledWith("s1", "docs/user_guide.md");
  });

  it("passes a refused read on with its status and code", async () => {
    vi.mocked(apiGetSolutionFile).mockResolvedValue(
      Response.json({ detail: { error: "not_found", message: "file not found" } }, { status: 404 }),
    );

    const res = await get("docs/.env");

    expect(res.status).toBe(404);
    expect((await res.json()).detail.error).toBe("not_found");
  });

  it("refuses a missing or overlong path before the api", async () => {
    expect((await get(null)).status).toBe(422);
    expect((await get("a".repeat(513))).status).toBe(422);
    expect(apiGetSolutionFile).not.toHaveBeenCalled();
  });

  it("has no files beside poc/ without wizard_api", async () => {
    vi.mocked(wizardApiEnabled).mockReturnValue(false);

    const res = await get("docs/user_guide.md");

    expect(res.status).toBe(404);
    expect(apiGetSolutionFile).not.toHaveBeenCalled();
  });
});
