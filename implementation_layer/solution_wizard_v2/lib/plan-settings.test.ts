import { describe, expect, it } from "vitest";
import { readableSettings } from "./plan-settings";

describe("readableSettings", () => {
  it("keeps plain values in order", () => {
    expect(readableSettings({ provider: "Azure AI Search", top_k: "5" })).toEqual([
      ["provider", "Azure AI Search"],
      ["top_k", "5"],
    ]);
  });

  it("leaves out JSON values and empty ones", () => {
    expect(
      readableSettings({
        transcriber_ctor: '{"model": "whisper", "language": "fi"}',
        fields: ' ["a", "b"]',
        note: "  ",
        model: "gpt-4o",
      }),
    ).toEqual([["model", "gpt-4o"]]);
  });

  it("has nothing for a step without settings", () => {
    expect(readableSettings(undefined)).toEqual([]);
  });
});
