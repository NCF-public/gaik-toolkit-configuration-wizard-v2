import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The route's collaborators are mocked so the test exercises only the routing
// logic: the owner check, the two answers, and what the session library's
// result becomes.
vi.mock("@/lib/session-access", () => ({
  requireOwnedSession: vi.fn(),
}));
vi.mock("@/lib/sessions", () => ({
  answerSessionRecording: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST } from "@/app/api/sessions/[id]/recording/route";
import { requireOwnedSession } from "@/lib/session-access";
import { answerSessionRecording } from "@/lib/sessions";

function post(body: unknown) {
  const req = new NextRequest("http://localhost/api/sessions/s1/recording", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: "s1" }) });
}

beforeEach(() => {
  vi.mocked(requireOwnedSession).mockResolvedValue({
    user: { email: "dev@gaik.local" },
    session: { id: "s1", step: 1 },
  } as never);
  vi.mocked(answerSessionRecording).mockResolvedValue("ok");
});

afterEach(() => vi.clearAllMocks());

describe("POST /sessions/[id]/recording", () => {
  it("answers 404 for a session that is not the signed-in user's, and answers nothing", async () => {
    vi.mocked(requireOwnedSession).mockResolvedValue(null);

    const res = await post({ answer: "stored" });

    expect(res.status).toBe(404);
    expect(answerSessionRecording).not.toHaveBeenCalled();
  });

  it.each(["stored", "not_stored"])("passes the answer %s on", async (answer) => {
    const res = await post({ answer });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recording: answer });
    expect(answerSessionRecording).toHaveBeenCalledWith("s1", answer);
  });

  it.each([{ answer: "not_asked" }, { answer: true }, {}, null])("refuses %j as an answer", async (body) => {
    const res = await post(body);

    expect(res.status).toBe(400);
    expect(answerSessionRecording).not.toHaveBeenCalled();
  });

  it("answers 409 when the session already has the other answer", async () => {
    vi.mocked(answerSessionRecording).mockResolvedValue("answered");

    expect((await post({ answer: "stored" })).status).toBe(409);
  });

  it("answers 502 when the answer could not be given", async () => {
    vi.mocked(answerSessionRecording).mockResolvedValue("failed");

    expect((await post({ answer: "stored" })).status).toBe(502);
  });
});
