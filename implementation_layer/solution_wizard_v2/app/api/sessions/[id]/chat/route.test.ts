import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The route's collaborators are mocked so the test exercises only the routing
// logic: mock reply by default, proxy to wizard_api when the agent is enabled,
// and graceful fallback to the mock on any upstream failure.
vi.mock("@/lib/session-access", () => ({
  requireOwnedSession: vi.fn(),
}));
vi.mock("@/lib/i18n", () => ({
  getI18n: vi.fn(async () => ({ t: {} })),
}));
vi.mock("@/lib/sessions", () => ({
  postMessage: vi.fn(async () => undefined),
}));
vi.mock("@/lib/chat-driver", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/chat-driver")>(
      "@/lib/chat-driver",
    );
  return { ...actual, resolveChatReply: vi.fn(async () => "MOCK") };
});
vi.mock("@/lib/wizard-api-client", () => ({
  wizardAgentChatEnabled: vi.fn(() => false),
  openAgentChatStream: vi.fn(),
}));

import { POST } from "@/app/api/sessions/[id]/chat/route";
import { requireOwnedSession } from "@/lib/session-access";
import { resolveChatReply } from "@/lib/chat-driver";
import {
  openAgentChatStream,
  wizardAgentChatEnabled,
} from "@/lib/wizard-api-client";

function post(message = "hi") {
  const req = new NextRequest("http://localhost/api/sessions/s1/chat", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  return POST(req, { params: Promise.resolve({ id: "s1" }) });
}

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out;
}

function upstreamSse(...frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const f of frames) c.enqueue(enc.encode(`data: ${f}\n\n`));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

beforeEach(() => {
  vi.mocked(requireOwnedSession).mockResolvedValue({
    user: { email: "dev@gaik.local" },
    session: { id: "s1", step: 2 },
  } as never);
  vi.mocked(resolveChatReply).mockResolvedValue("MOCK");
  vi.mocked(wizardAgentChatEnabled).mockReturnValue(false);
});

afterEach(() => vi.clearAllMocks());

describe("POST /sessions/[id]/chat", () => {
  it("returns 400 on an empty message", async () => {
    const res = await post("   ");
    expect(res.status).toBe(400);
  });

  it("streams the mock reply when the agent is disabled", async () => {
    const res = await post();
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await readAll(res);
    expect(body).toContain('"delta"');
    expect(body).toContain("MOCK");
    expect(body).toContain('"done":true');
    expect(openAgentChatStream).not.toHaveBeenCalled();
  });

  it("proxies the upstream agent stream when enabled", async () => {
    vi.mocked(wizardAgentChatEnabled).mockReturnValue(true);
    vi.mocked(openAgentChatStream).mockResolvedValue(
      upstreamSse('{"delta":"AGENT"}', '{"done":true}'),
    );
    const res = await post();
    const body = await readAll(res);
    expect(body).toContain("AGENT");
    // The mock path must not run when the proxy handled the request.
    expect(resolveChatReply).not.toHaveBeenCalled();
  });

  it("falls back to the mock when the upstream throws", async () => {
    vi.mocked(wizardAgentChatEnabled).mockReturnValue(true);
    vi.mocked(openAgentChatStream).mockRejectedValue(
      new Error("connect ECONNREFUSED"),
    );
    const res = await post();
    const body = await readAll(res);
    expect(body).toContain("MOCK");
    expect(body).toContain('"done":true');
  });

  it("falls back to the mock when the upstream is not ok", async () => {
    vi.mocked(wizardAgentChatEnabled).mockReturnValue(true);
    vi.mocked(openAgentChatStream).mockResolvedValue(
      new Response("nope", { status: 404 }),
    );
    const res = await post();
    const body = await readAll(res);
    expect(body).toContain("MOCK");
  });
});
