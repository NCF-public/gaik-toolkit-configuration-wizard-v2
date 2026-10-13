import { afterEach, describe, expect, it, vi } from "vitest";
import {
  wizardApiEnabled,
  wizardAgentChatEnabled,
} from "@/lib/wizard-api-client";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("wizardAgentChatEnabled", () => {
  it("is off when the wizard_api URL is not set, even with the flag on", () => {
    vi.stubEnv("WIZARD_API_URL", "");
    vi.stubEnv("WIZARD_AGENT_CHAT", "true");
    expect(wizardApiEnabled()).toBe(false);
    expect(wizardAgentChatEnabled()).toBe(false);
  });

  it("is off when the API is set but the agent flag is not 'true'", () => {
    vi.stubEnv("WIZARD_API_URL", "http://localhost:8100");
    vi.stubEnv("WIZARD_AGENT_CHAT", "");
    expect(wizardApiEnabled()).toBe(true);
    expect(wizardAgentChatEnabled()).toBe(false);
  });

  it("is on only when the API is set and the flag is exactly 'true'", () => {
    vi.stubEnv("WIZARD_API_URL", "http://localhost:8100");
    vi.stubEnv("WIZARD_AGENT_CHAT", "true");
    expect(wizardAgentChatEnabled()).toBe(true);
  });
});
