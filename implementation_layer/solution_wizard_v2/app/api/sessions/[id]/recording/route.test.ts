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
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { POST } from "@/app/api/sessions/[id]/recording/route";
import { requireOwnedSession } from "@/lib/session-access";
import { answerSessionRecording } from "@/lib/sessions";
import { audit } from "@/lib/audit";

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
  vi.mocked(answerSessionRecording).mockResolvedValue({ status: "ok" });
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

  it("answers 409 with the answer that stands when the session already has the other one", async () => {
    vi.mocked(answerSessionRecording).mockResolvedValue({ status: "answered", inForce: "stored" });

    const res = await post({ answer: "not_stored" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_answered", recording: "stored" });
  });

  it("leaves an audit record of the answer, and of a refused one", async () => {
    await post({ answer: "not_stored" });
    expect(audit).toHaveBeenLastCalledWith(
      "session.recording",
      expect.objectContaining({
        actor: "dev@gaik.local",
        resource: { type: "session", id: "s1" },
        outcome: "success",
        answer: "not_stored",
      }),
    );

    vi.mocked(answerSessionRecording).mockResolvedValue({ status: "answered", inForce: "not_stored" });
    await post({ answer: "stored" });
    expect(audit).toHaveBeenLastCalledWith(
      "session.recording",
      expect.objectContaining({ outcome: "denied", answer: "stored", reason: "already_answered" }),
    );
  });

  it("answers 502 when the answer could not be given", async () => {
    vi.mocked(answerSessionRecording).mockResolvedValue({ status: "failed" });

    expect((await post({ answer: "stored" })).status).toBe(502);
  });
});
