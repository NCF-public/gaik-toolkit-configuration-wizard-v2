import { afterEach, describe, expect, it, vi } from "vitest";
import { fieldName } from "@/lib/blueprint-field-names";
import { LOCALES, dictionary } from "@/lib/i18n";
import {
  OperationRefused,
  postOperations,
  postUndo,
  refusalOf,
  refusalText,
  saveRefusal,
  type BlueprintOperation,
} from "@/lib/blueprint-ops";

const BLUEPRINT = { name: "Invoices", description: "", goal: "", steps: [] };

function answer(status: number, body: unknown) {
  return vi.fn(async () => Response.json(body, { status }));
}

afterEach(() => vi.unstubAllGlobals());

describe("postOperations", () => {
  const ops: BlueprintOperation[] = [{ op: "rename_step", step_id: "s1", name: "Read the invoice" }];

  it("sends the base version and the operations to the session's route", async () => {
    const fetchMock = answer(200, {
      session: { id: "abc", active_version: 4, blueprint: BLUEPRINT },
      warnings: ["w"],
      needs_attention: ["steps[0].component"],
      bpmn_changed: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await postOperations("abc", 3, ops);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/sessions/abc/blueprint/operations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ base_version: 3, operations: ops });
    expect(result).toEqual({
      blueprint: BLUEPRINT,
      warnings: ["w"],
      needsAttention: ["steps[0].component"],
      bpmnChanged: true,
      version: 4,
    });
  });

  it("maps 409 changed_elsewhere to OperationRefused", async () => {
    vi.stubGlobal(
      "fetch",
      answer(409, {
        detail: {
          error: "changed_elsewhere",
          message: "The blueprint has changed since this diagram was loaded; reload it and edit again.",
          trace_id: "trace-0000-1111",
        },
      }),
    );

    const err = await postOperations("abc", 3, ops).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OperationRefused);
    expect(err).toMatchObject({
      status: 409,
      code: "changed_elsewhere",
      message: "The blueprint has changed since this diagram was loaded; reload it and edit again.",
    });
    expect((err as OperationRefused).field).toBeUndefined();
  });

  it("maps 422 invalid_operation to OperationRefused with its field and index", async () => {
    vi.stubGlobal(
      "fetch",
      answer(422, {
        detail: {
          error: "invalid_operation",
          message: "No step s9.",
          field: "operations[0].step_id",
          index: 0,
          code: "not_found",
          trace_id: "trace-0000-1111",
        },
      }),
    );

    const err = await postOperations("abc", 3, ops).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OperationRefused);
    expect(err).toMatchObject({
      status: 422,
      code: "invalid_operation",
      field: "operations[0].step_id",
      index: 0,
      reason: "not_found",
      message: "No step s9.",
    });
  });

  it("maps the route's own 503 in mock mode to a plain error, not a refusal", async () => {
    vi.stubGlobal("fetch", answer(503, { error: "needs_wizard_api" }));

    const err = await postOperations("abc", 3, ops).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(OperationRefused);
  });

  it("refuses an answer without a blueprint", async () => {
    vi.stubGlobal("fetch", answer(200, { warnings: [] }));
    await expect(postOperations("abc", 3, ops)).rejects.toThrow();
  });

  it("encodes the session id into the path", async () => {
    const fetchMock = answer(200, {
      session: { active_version: 2, blueprint: BLUEPRINT },
      warnings: [],
      needs_attention: [],
      bpmn_changed: false,
    });
    vi.stubGlobal("fetch", fetchMock);
    await postOperations("a/b", 1, ops);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/sessions/a%2Fb/blueprint/operations");
  });
});

describe("refusalOf", () => {
  it("reads a relayed detail and the route's own flat refusal", () => {
    expect(refusalOf({ detail: { error: "unsupported_edit", message: "Ask the wizard." } })).toEqual({
      code: "unsupported_edit",
      message: "Ask the wizard.",
    });
    expect(refusalOf({ error: "changed_elsewhere" })).toEqual({ code: "changed_elsewhere", message: "" });
  });

  it("reads nothing from a body that is no refusal", () => {
    expect(refusalOf(null)).toBeNull();
    expect(refusalOf("Session not found")).toBeNull();
    expect(refusalOf({ detail: [{ loc: ["body"], msg: "x" }] })).toBeNull();
  });
});

const FI = dictionary("fi");
const EN = dictionary("en");

describe("refusalText (a refusal in the UI language)", () => {
  const op = (reason: string, field?: string) => ({
    code: "invalid_operation",
    message: "The edit would make a loop through steps \"A\", \"B\"",
    reason,
    ...(field ? { field } : {}),
  });

  it("maps the codes and operation reasons the server sends", () => {
    expect(refusalText({ code: "agent_busy", message: "x" }, FI)).toBe(FI.bpmnAgentBusy);
    expect(refusalText({ code: "no_draft", message: "x" }, EN)).toBe(EN.bpmnNeedsDraft);
    expect(refusalText({ code: "unsupported_edit", message: "x" }, FI)).toBe(FI.opRefusalUnsupportedEdit);
    expect(refusalText(op("cycle"), FI)).toBe(FI.bpmnLoopRefused);
    expect(refusalText(op("lane_in_use"), EN)).toBe(EN.bpmnLaneInUse);
    expect(refusalText(op("second_producer"), FI)).toBe(FI.bpmnDataSecondProducer);
    expect(refusalText(op("still_used"), FI)).toBe(FI.bpmnDataStillUsed);
    expect(refusalText(op("only_producer"), FI)).toBe(FI.bpmnDataOnlyProducer);
    expect(refusalText(op("already_linked"), FI)).toBe(FI.bpmnDataAlreadyLinked);
    expect(refusalText(op("not_found"), FI)).toBe(FI.opRefusalNotFound);
    expect(refusalText(op("last_step"), EN)).toBe(EN.opRefusalLastStep);
    expect(refusalText(op("unknown_step"), FI)).toBe(FI.opRefusalUnknownStep);
  });

  it("names the field of a read-only section or an invalid draft", () => {
    expect(refusalText({ code: "readonly_section", message: "x", field: "gate_1" }, EN)).toBe(
      EN.wsJsonReadonlySection.replace("{field}", fieldName("gate_1", "en")),
    );
    expect(refusalText({ code: "invalid_draft", message: "x", field: "steps[0].name" }, FI)).toBe(
      FI.wsJsonInvalidDraft.replace("{field}", fieldName("steps[0].name", "fi")),
    );
    expect(refusalText({ code: "readonly_section", message: "x" }, FI)).toBeNull();
  });

  it("says a generic refusal for an operation with an unmapped reason", () => {
    expect(refusalText(op("invalid"), FI)).toBe(FI.bpmnOpRefused);
    expect(refusalText(op("invalid", "step_id"), EN)).toContain("step");
  });

  it("is null for a code it has no text for", () => {
    expect(refusalText({ code: "something_new", message: "In English" }, FI)).toBeNull();
  });

  it("has a text in every language for each new key, in correct Finnish", () => {
    for (const locale of LOCALES) {
      const d = dictionary(locale);
      for (const text of [d.opRefusalUnsupportedEdit, d.opRefusalNotFound, d.opRefusalLastStep, d.opRefusalUnknownStep]) {
        expect(text.length).toBeGreaterThan(10);
      }
    }
    expect(FI.opRefusalNotFound).toContain("löydy");
    expect(FI.opRefusalLastStep).toContain("vähintään");
  });
});

describe("saveRefusal (the form, flow and canvas saves)", () => {
  it("reads changed_elsewhere, from the route itself or relayed from wizard_api", () => {
    expect(saveRefusal(409, { error: "changed_elsewhere" }, FI)).toEqual({ kind: "changed" });
    expect(saveRefusal(409, { detail: { error: "changed_elsewhere", message: "reload" } }, FI)).toEqual({
      kind: "changed",
    });
  });

  it("tells a known refusal in the UI language, not in the server's words", () => {
    expect(
      saveRefusal(422, { detail: { error: "unsupported_edit", message: "Ask the wizard to change x." } }, FI),
    ).toEqual({ kind: "refused", message: FI.opRefusalUnsupportedEdit });
    expect(saveRefusal(409, { detail: { error: "agent_busy", message: "The wizard is replying." } }, EN)).toEqual({
      kind: "refused",
      message: EN.bpmnAgentBusy,
    });
    expect(
      saveRefusal(422, { detail: { error: "invalid_operation", code: "cycle", message: "The edit would make a loop" } }, FI),
    ).toEqual({ kind: "refused", message: FI.bpmnLoopRefused });
  });

  it("gives the server's own message for a code it has no text for", () => {
    expect(saveRefusal(422, { detail: { error: "something_new", message: "Not like this." } }, FI)).toEqual({
      kind: "refused",
      message: "Not like this.",
    });
  });

  it("is nothing for a success, another status or a refusal without words", () => {
    expect(saveRefusal(200, { blueprint: {} }, FI)).toBeNull();
    expect(saveRefusal(500, { detail: { error: "internal_error", message: "x" } }, FI)).toBeNull();
    expect(saveRefusal(422, { detail: [{ loc: ["body"], msg: "x" }] }, FI)).toBeNull();
    expect(saveRefusal(422, { detail: { error: "something_new", message: "" } }, FI)).toBeNull();
  });
});

describe("postUndo", () => {
  it("sends the base version to the undo route and gives the blueprint and the new version", async () => {
    const fetchMock = answer(200, { id: "abc", active_version: 6, blueprint: BLUEPRINT });
    vi.stubGlobal("fetch", fetchMock);

    expect(await postUndo("abc", 5)).toEqual({ blueprint: BLUEPRINT, version: 6 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/sessions/abc/blueprint/undo");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ base_version: 5 });
  });

  it("throws OperationRefused for nothing_to_undo", async () => {
    vi.stubGlobal(
      "fetch",
      answer(409, { detail: { error: "nothing_to_undo", message: "There is nothing to undo." } }),
    );
    await expect(postUndo("abc", 5)).rejects.toMatchObject({ name: "OperationRefused", code: "nothing_to_undo" });
  });

  it("throws a plain error without wizard_api", async () => {
    vi.stubGlobal("fetch", answer(503, { error: "needs_wizard_api" }));
    await expect(postUndo("abc", 5)).rejects.not.toBeInstanceOf(OperationRefused);
  });
});
