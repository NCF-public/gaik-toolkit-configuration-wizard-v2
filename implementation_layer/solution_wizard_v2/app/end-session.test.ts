import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  requireOwnedSession: vi.fn(),
  endAgent: vi.fn(),
}));

vi.mock("@/lib/session-access", () => ({ requireOwnedSession: state.requireOwnedSession }));
vi.mock("@/lib/sessions", () => ({ endAgent: state.endAgent }));

import { endSession } from "./end-session";

beforeEach(() => {
  vi.clearAllMocks();
  state.requireOwnedSession.mockResolvedValue({
    user: { email: "alice@example.test" },
    session: { id: "s1" },
  });
  state.endAgent.mockResolvedValue("ended");
});

describe("endSession", () => {
  it("releases the wizard of the user's own session", async () => {
    expect(await endSession("s1")).toBe("ended");
    expect(state.requireOwnedSession).toHaveBeenCalledWith("s1");
    expect(state.endAgent).toHaveBeenCalledTimes(1);
    expect(state.endAgent).toHaveBeenCalledWith("s1");
  });

  it("says when the wizard is still replying, and when it could not be released", async () => {
    state.endAgent.mockResolvedValueOnce("busy");
    expect(await endSession("s1")).toBe("busy");
    state.endAgent.mockResolvedValueOnce("failed");
    expect(await endSession("s1")).toBe("failed");
  });

  it("ends nothing for a session that is not the user's, or for no session at all", async () => {
    state.requireOwnedSession.mockResolvedValue(null);
    expect(await endSession("s2")).toBe("failed");
    expect(await endSession(undefined as unknown as string)).toBe("failed");
    expect(state.requireOwnedSession).toHaveBeenLastCalledWith("");
    expect(state.endAgent).not.toHaveBeenCalled();
  });
});
