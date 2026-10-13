import { describe, expect, it } from "vitest";
import { parseBlueprintJson } from "@/lib/blueprint-parse";

describe("parseBlueprintJson", () => {
  it("parses a valid V2 blueprint", () => {
    const parsed = parseBlueprintJson(
      JSON.stringify({
        name: "Demo",
        description: "d",
        goal: "g",
        steps: [{ id: "input", name: "Syöte", type: "io" }],
      }),
    );
    expect(parsed?.steps[0]?.name).toBe("Syöte");
  });

  it("rejects invalid step types", () => {
    expect(
      parseBlueprintJson(
        JSON.stringify({
          name: "Demo",
          steps: [{ id: "x", name: "Bad", type: "unknown" }],
        }),
      ),
    ).toBeNull();
  });
});
