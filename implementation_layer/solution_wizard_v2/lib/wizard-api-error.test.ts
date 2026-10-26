import { describe, expect, it } from "vitest";
import { WizardApiError } from "@/lib/wizard-api-client";

describe("WizardApiError", () => {
  it("reads the code of a structured refusal", () => {
    const body = JSON.stringify({
      detail: { error: "gate_not_ready", gate: "gate_2", missing: "the workflow diagram" },
    });
    const err = new WizardApiError(409, "/sessions/x", body);
    expect(err.status).toBe(409);
    expect(err.code).toBe("gate_not_ready");
    expect(err.message).toBe(`wizard_api 409 /sessions/x: ${body}`);
  });

  it("has no code for a plain or non-JSON body", () => {
    expect(new WizardApiError(404, "/x", JSON.stringify({ detail: "session not found" })).code).toBeUndefined();
    expect(new WizardApiError(502, "/x", "Bad Gateway").code).toBeUndefined();
  });
});
