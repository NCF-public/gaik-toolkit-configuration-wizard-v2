import { describe, expect, it } from "vitest";
import { backgroundIn, isBackground, toggleBackground } from "./chat-background";

const sentences = {
  nonTechnical: "Taustani: en ole tekninen. Kysy arkikielellä. ",
  technical: "Taustani: olen tekninen. ",
};

describe("background chips", () => {
  it("put their sentence at the start of the message, before what the user wrote", () => {
    expect(toggleBackground("", "nonTechnical", sentences)).toBe("Taustani: en ole tekninen. Kysy arkikielellä. ");
    expect(toggleBackground("Haluan luokitella laskut.", "technical", sentences)).toBe(
      "Taustani: olen tekninen. Haluan luokitella laskut.",
    );
  });

  it("swap one sentence for the other and keep the rest", () => {
    const first = toggleBackground("Laskut.", "nonTechnical", sentences);
    expect(toggleBackground(first, "technical", sentences)).toBe("Taustani: olen tekninen. Laskut.");
  });

  it("take their sentence out when pressed again", () => {
    const on = toggleBackground("Laskut.", "nonTechnical", sentences);
    expect(toggleBackground(on, "nonTechnical", sentences)).toBe("Laskut.");
    expect(toggleBackground(sentences.technical, "technical", sentences)).toBe("");
  });

  it("know which one the message starts with, also without the trailing space", () => {
    expect(backgroundIn("Taustani: olen tekninen.", sentences)).toBe("technical");
    expect(backgroundIn("Taustani: olen tekninen. Laskut", sentences)).toBe("technical");
    expect(backgroundIn("Laskut. Taustani: olen tekninen.", sentences)).toBeNull();
    expect(backgroundIn("Taustani: olen", sentences)).toBeNull();
  });

  it("read only a known choice back from storage", () => {
    expect(isBackground("technical")).toBe(true);
    expect(isBackground("admin")).toBe(false);
    expect(isBackground(null)).toBe(false);
  });
});
