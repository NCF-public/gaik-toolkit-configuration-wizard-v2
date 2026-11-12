import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildGateStatus, type GateStatus } from "@/lib/wizard-state-machine";

/** `redirect` ends the action in Next by throwing; here it throws its target. */
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}

const next = vi.hoisted(() => ({ revalidatePath: vi.fn(), redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: next.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: next.redirect }));

const access = vi.hoisted(() => ({ requireOwnedSession: vi.fn() }));
vi.mock("@/lib/session-access", () => access);

const sessions = vi.hoisted(() => ({
  advanceSession: vi.fn(),
  regressSession: vi.fn(),
  approveGate: vi.fn(),
  rejectGate: vi.fn(),
  reopenGate: vi.fn(),
  endAgent: vi.fn(),
}));
vi.mock("@/lib/sessions", () => sessions);

import { approve, reject } from "./actions";
import { WizardApiError } from "@/lib/wizard-api-client";

type Standing = {
  step: number;
  gateStatus: Record<number, GateStatus>;
  lastSuccessfulRun?: string | null;
  messages: { role: string; content: string }[];
  pendingTurn?: unknown;
};

function at(step: number, over: Partial<Standing> = {}): Standing {
  return { step, gateStatus: buildGateStatus(step), messages: [], ...over };
}

function form(step: number, feedback?: string): FormData {
  const data = new FormData();
  data.set("id", "s1");
  data.set("step", String(step));
  if (feedback !== undefined) data.set("feedback", feedback);
  return data;
}

/** Run an action to its redirect; null when it ends without one. */
async function redirectOf(run: Promise<unknown>): Promise<string | null> {
  try {
    await run;
    return null;
  } catch (err) {
    if (err instanceof Redirected) return err.to;
    throw err;
  }
}

const busy = () => new WizardApiError(409, "/sessions/s1", JSON.stringify({ detail: { error: "agent_busy" } }));

beforeEach(() => {
  vi.clearAllMocks();
  next.redirect.mockImplementation((to: string) => {
    throw new Redirected(to);
  });
});

describe("approve", () => {
  it("from the PoC step moves the session onto Gate 3 and approves that gate only", async () => {
    access.requireOwnedSession.mockResolvedValue({ session: at(10, { lastSuccessfulRun: "run-1" }) });
    sessions.advanceSession.mockResolvedValue(at(11));
    sessions.approveGate.mockResolvedValue(at(12));

    expect(await redirectOf(approve(form(11)))).toBe("/sessions/s1?wake=3");
    // The move is made from the step the page saw, the approval for the form's gate.
    expect(sessions.advanceSession).toHaveBeenCalledWith("s1", 10);
    expect(sessions.approveGate).toHaveBeenCalledWith("s1", 11);
  });

  it("a second approval of Gate 3 that arrives after the first approves nothing more", async () => {
    // Both requests read the session on the PoC step. The first has approved
    // Gate 3 by the time this one moves: the session stands on step 12, and
    // must not be moved on to Gate 4 and approved there.
    access.requireOwnedSession.mockResolvedValue({ session: at(10, { lastSuccessfulRun: "run-1" }) });
    sessions.advanceSession.mockResolvedValue(at(12));

    expect(await redirectOf(approve(form(11)))).toBe("/sessions/s1?notice=gate_moved");
    expect(sessions.advanceSession).toHaveBeenCalledWith("s1", 10);
    expect(sessions.approveGate).not.toHaveBeenCalled();
  });

  it("while the wizard is replying says that it is busy, not that the gate has moved", async () => {
    // The page offered Gate 4 from the documentation step, then a message was
    // sent: the session has not moved, the wizard is answering.
    access.requireOwnedSession.mockResolvedValue({
      session: at(12, { pendingTurn: { userMessage: "Lisää ohje." }, messages: [{ role: "user", content: "Lisää ohje." }] }),
    });
    sessions.advanceSession.mockRejectedValue(busy());

    expect(await redirectOf(approve(form(13)))).toBe("/sessions/s1?notice=agent_busy");
    expect(sessions.approveGate).not.toHaveBeenCalled();
  });

  it("a form for a gate the session has left is told so, and nothing is moved", async () => {
    access.requireOwnedSession.mockResolvedValue({ session: at(12) });

    expect(await redirectOf(approve(form(11)))).toBe("/sessions/s1?notice=gate_moved");
    expect(sessions.advanceSession).not.toHaveBeenCalled();
    expect(sessions.approveGate).not.toHaveBeenCalled();
  });

  it("on the gate itself approves without a move", async () => {
    access.requireOwnedSession.mockResolvedValue({ session: at(9) });
    sessions.approveGate.mockResolvedValue(at(10));

    expect(await redirectOf(approve(form(9)))).toBe("/sessions/s1?wake=2");
    expect(sessions.advanceSession).not.toHaveBeenCalled();
    expect(sessions.approveGate).toHaveBeenCalledWith("s1", 9);
  });
});

describe("reject", () => {
  it("from the PoC step moves onto Gate 3 and rejects that gate only", async () => {
    access.requireOwnedSession.mockResolvedValue({ session: at(10, { lastSuccessfulRun: "run-1" }) });
    sessions.advanceSession.mockResolvedValue(at(11));
    sessions.rejectGate.mockResolvedValue(at(11, { gateStatus: { ...buildGateStatus(11), 11: "rejected" } }));

    expect(await reject(form(11, "Summa puuttuu."))).toBe("saved");
    expect(sessions.advanceSession).toHaveBeenCalledWith("s1", 10);
    expect(sessions.rejectGate).toHaveBeenCalledWith("s1", 11);
  });

  it("a rejection that arrives after the gate was decided rejects nothing", async () => {
    access.requireOwnedSession.mockResolvedValue({ session: at(10, { lastSuccessfulRun: "run-1" }) });
    sessions.advanceSession.mockResolvedValue(at(12));

    expect(await reject(form(11, "Summa puuttuu."))).toBe("moved");
    expect(sessions.rejectGate).not.toHaveBeenCalled();
  });

  it("when the rejection fails after the move, the page is read again: the session stands on the gate", async () => {
    access.requireOwnedSession.mockResolvedValue({ session: at(10, { lastSuccessfulRun: "run-1" }) });
    sessions.advanceSession.mockResolvedValue(at(11));
    sessions.rejectGate.mockRejectedValue(new Error("wizard_api 500"));

    expect(await reject(form(11, "Summa puuttuu."))).toBe("failed");
    expect(next.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("when the move itself is refused, nothing has changed and nothing is read again", async () => {
    access.requireOwnedSession.mockResolvedValue({ session: at(10, { lastSuccessfulRun: "run-1" }) });
    sessions.advanceSession.mockRejectedValue(busy());

    expect(await reject(form(11, "Summa puuttuu."))).toBe("failed");
    expect(sessions.rejectGate).not.toHaveBeenCalled();
    expect(next.revalidatePath).not.toHaveBeenCalled();
  });
});
