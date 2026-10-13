import { beforeEach, describe, expect, it, vi } from "vitest";
import { GATE_STEPS, isGateStep } from "@/lib/wizard-state-machine";

const PHASE_COUNT = 13;

const mockFns = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getSession: vi.fn(),
  createSession: vi.fn(),
  postMessage: vi.fn(),
  advanceSession: vi.fn(),
  regressSession: vi.fn(),
  approveGate: vi.fn(),
  rejectGate: vi.fn(),
  requestGateChanges: vi.fn(),
  recordRequirementAnswer: vi.fn(),
  updateBlueprint: vi.fn(),
}));

vi.mock("@/lib/mock-sessions", () => ({
  PHASE_COUNT: 13,
  GATE_STEPS,
  isGateStep,
  PHASES: [],
  BPMN_VISUAL_STEP: 8,
  isBpmnVisualPhase: (step: number) => step >= 8,
  listSessions: mockFns.listSessions,
  getSession: mockFns.getSession,
  createSession: mockFns.createSession,
  postMessage: mockFns.postMessage,
  advanceSession: mockFns.advanceSession,
  regressSession: mockFns.regressSession,
  approveGate: mockFns.approveGate,
  rejectGate: mockFns.rejectGate,
  requestGateChanges: mockFns.requestGateChanges,
  recordRequirementAnswer: mockFns.recordRequirementAnswer,
  updateBlueprint: mockFns.updateBlueprint,
}));

const apiFns = vi.hoisted(() => ({
  apiCreateSession: vi.fn(),
  apiGetSession: vi.fn(),
  apiListSessions: vi.fn(),
  apiPatchSession: vi.fn(),
  apiPatchBlueprint: vi.fn(),
  apiPostMessages: vi.fn(),
  apiPostVersion: vi.fn(),
}));

const wizardApiState = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/lib/wizard-api-client", () => ({
  apiCreateSession: apiFns.apiCreateSession,
  apiGetSession: apiFns.apiGetSession,
  apiListSessions: apiFns.apiListSessions,
  apiPatchSession: apiFns.apiPatchSession,
  apiPatchBlueprint: apiFns.apiPatchBlueprint,
  apiPostMessages: apiFns.apiPostMessages,
  apiPostVersion: apiFns.apiPostVersion,
  wizardApiEnabled: () => wizardApiState.enabled,
}));

import {
  advanceSession,
  approveGate,
  createSession,
  getSession,
  listSessions,
  patchSessionBlueprint,
  postMessage,
  recordRequirementAnswer,
  regressSession,
  rejectGate,
  requestGateChanges,
  saveBlueprintAfterBpmnSync,
} from "@/lib/sessions";

const blueprint = { name: "Demo", description: "", goal: "", steps: [] };

function apiDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "s1",
    user_id: "u1",
    title: "Demo",
    step: 4,
    status: "active",
    gate_statuses: {},
    metadata: {},
    output_dir: "output/s1/",
    active_version: 1,
    versions: [],
    blueprint,
    messages: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  wizardApiState.enabled = false;
});

describe("sessions.ts — mock mode (WIZARD_API_URL unset)", () => {
  beforeEach(() => {
    wizardApiState.enabled = false;
  });

  it("listSessions delegates to the mock store", async () => {
    mockFns.listSessions.mockResolvedValue([]);
    await listSessions("u1");
    expect(mockFns.listSessions).toHaveBeenCalledWith("u1");
    expect(apiFns.apiListSessions).not.toHaveBeenCalled();
  });

  it("getSession delegates to the mock store", async () => {
    mockFns.getSession.mockResolvedValue(undefined);
    await getSession("s1");
    expect(mockFns.getSession).toHaveBeenCalledWith("s1");
    expect(apiFns.apiGetSession).not.toHaveBeenCalled();
  });

  it("createSession delegates to the mock store", async () => {
    mockFns.createSession.mockResolvedValue({ id: "s1" });
    await createSession("u1", "Demo");
    expect(mockFns.createSession).toHaveBeenCalledWith("u1", "Demo");
    expect(apiFns.apiCreateSession).not.toHaveBeenCalled();
  });

  it("recordRequirementAnswer delegates to the mock store", async () => {
    mockFns.recordRequirementAnswer.mockResolvedValue(undefined);
    await recordRequirementAnswer("s1", "answer");
    expect(mockFns.recordRequirementAnswer).toHaveBeenCalledWith("s1", "answer");
  });
});

describe("sessions.ts — wizard_api mode (WIZARD_API_URL set)", () => {
  beforeEach(() => {
    wizardApiState.enabled = true;
  });

  it("listSessions maps API summaries to WizardSession shape", async () => {
    apiFns.apiListSessions.mockResolvedValue([
      {
        id: "s1",
        user_id: "u1",
        step: 2,
        gate_statuses: {},
        metadata: {},
        output_dir: "output/s1/",
        active_version: 1,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const result = await listSessions("u1");
    expect(mockFns.listSessions).not.toHaveBeenCalled();
    expect(result[0].id).toBe("s1");
    expect(result[0].title).toBe("Nimetön sessio");
    expect(result[0].status).toBe("active");
  });

  it("getSession maps a full API detail and returns undefined on error", async () => {
    apiFns.apiGetSession.mockResolvedValueOnce(apiDetail());
    const found = await getSession("s1");
    expect(found?.id).toBe("s1");
    expect(found?.gateStatus[4]).toBe("pending"); // step=4 is Gate 1, no gate_statuses.gate_1 set

    apiFns.apiGetSession.mockRejectedValueOnce(new Error("404"));
    const missing = await getSession("missing");
    expect(missing).toBeUndefined();
  });

  it("createSession posts to the API and maps the result", async () => {
    apiFns.apiCreateSession.mockResolvedValue(apiDetail());
    const session = await createSession("u1", "Demo");
    expect(apiFns.apiCreateSession).toHaveBeenCalledWith("u1", "Demo");
    expect(session.title).toBe("Demo");
  });

  it("postMessage posts and returns undefined on failure instead of throwing", async () => {
    apiFns.apiPostMessages.mockRejectedValueOnce(new Error("boom"));
    const result = await postMessage("s1", "hi", "hello");
    expect(result).toBeUndefined();
  });

  it("advanceSession patches the step and adds a version when the transition advances", async () => {
    apiFns.apiGetSession.mockResolvedValue(apiDetail({ step: 1 }));
    await advanceSession("s1");
    expect(apiFns.apiPatchSession).toHaveBeenCalledWith("s1", { step: 2 });
    expect(apiFns.apiPostVersion).toHaveBeenCalledWith("s1", "Vaihe 2");
  });

  it("advanceSession is a no-op past the last step", async () => {
    apiFns.apiGetSession.mockResolvedValue(apiDetail({ step: PHASE_COUNT }));
    const result = await advanceSession("s1");
    expect(apiFns.apiPatchSession).not.toHaveBeenCalled();
    expect(result?.step).toBe(PHASE_COUNT);
  });

  it("regressSession patches the step back and reactivates the session", async () => {
    apiFns.apiGetSession.mockResolvedValue(apiDetail({ step: 2 }));
    await regressSession("s1");
    expect(apiFns.apiPatchSession).toHaveBeenCalledWith("s1", {
      step: 1,
      metadata: { status: "active" },
    });
  });

  it("approveGate patches gate_statuses and advances past a non-final gate", async () => {
    // First fetch (inside approveGate): gate not yet approved. Second fetch
    // (inside the advanceSession it triggers): as if the PATCH already landed.
    apiFns.apiGetSession
      .mockResolvedValueOnce(apiDetail({ step: 4, gate_statuses: {} }))
      .mockResolvedValueOnce(apiDetail({ step: 4, gate_statuses: { gate_1: "approved" } }));
    await approveGate("s1");
    expect(apiFns.apiPatchSession).toHaveBeenCalledWith("s1", {
      gate_statuses: { gate_1: "approved" },
    });
    // advanceSession runs next and issues a second patch for the step move.
    expect(apiFns.apiPatchSession).toHaveBeenCalledTimes(2);
    expect(apiFns.apiPatchSession).toHaveBeenCalledWith("s1", { step: 5 });
  });

  it("approveGate on the final gate marks the session done in one patch", async () => {
    apiFns.apiGetSession.mockResolvedValue(apiDetail({ step: PHASE_COUNT }));
    apiFns.apiPatchSession.mockResolvedValue(apiDetail({ step: PHASE_COUNT, status: "done" }));
    await approveGate("s1");
    expect(apiFns.apiPatchSession).toHaveBeenCalledWith("s1", {
      gate_statuses: { gate_4: "approved" },
      metadata: { status: "done" },
    });
  });

  it("approveGate is a no-op when the current step is not a gate step", async () => {
    apiFns.apiGetSession.mockResolvedValue(apiDetail({ step: 2 }));
    await approveGate("s1");
    expect(apiFns.apiPatchSession).not.toHaveBeenCalled();
  });

  it("rejectGate patches gate_statuses to rejected and reactivates", async () => {
    apiFns.apiGetSession.mockResolvedValue(apiDetail({ step: 4 }));
    await rejectGate("s1");
    expect(apiFns.apiPatchSession).toHaveBeenCalledWith("s1", {
      gate_statuses: { gate_1: "rejected" },
      metadata: { status: "active" },
    });
  });

  it("requestGateChanges steps back, records feedback, and re-fetches", async () => {
    apiFns.apiGetSession.mockResolvedValue(apiDetail({ step: 4 }));
    apiFns.apiPostMessages.mockResolvedValue(apiDetail({ step: 3 }));
    await requestGateChanges("s1", "please clarify", "got it");
    expect(apiFns.apiPatchSession).toHaveBeenCalledWith("s1", {
      step: 3,
      metadata: { status: "active" },
    });
    expect(apiFns.apiPostMessages).toHaveBeenCalledWith("s1", "please clarify", "got it");
  });

  it("recordRequirementAnswer just re-fetches the session in API mode (agent owns gathering)", async () => {
    apiFns.apiGetSession.mockResolvedValue(apiDetail());
    await recordRequirementAnswer("s1", "answer");
    expect(mockFns.recordRequirementAnswer).not.toHaveBeenCalled();
    expect(apiFns.apiGetSession).toHaveBeenCalled();
  });

  it("patchSessionBlueprint / saveBlueprintAfterBpmnSync PATCH the blueprint and return undefined on failure", async () => {
    apiFns.apiPatchBlueprint.mockResolvedValueOnce(apiDetail());
    const saved = await patchSessionBlueprint("s1", blueprint, "note");
    expect(apiFns.apiPatchBlueprint).toHaveBeenCalledWith("s1", blueprint, "note");
    expect(saved?.id).toBe("s1");

    apiFns.apiPatchBlueprint.mockRejectedValueOnce(new Error("boom"));
    const failed = await saveBlueprintAfterBpmnSync("s1", blueprint);
    expect(failed).toBeUndefined();
  });
});
