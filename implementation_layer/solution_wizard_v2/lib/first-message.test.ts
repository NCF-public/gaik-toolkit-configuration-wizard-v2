import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepFirstMessage, takeFirstMessage } from "./first-message";

const SESSION = "2fa204b7";
const KEY = `gaik-wizard:pending-first-message:${SESSION}`;

describe("the first message kept for the session page", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });
  afterEach(() => {
    // Nothing is left in memory for the next test.
    takeFirstMessage(SESSION);
    vi.unstubAllGlobals();
  });

  it("is taken once, by the session it was kept for", () => {
    keepFirstMessage(SESSION, { text: "Luokittele laskut", fieldTop: 320 });

    expect(takeFirstMessage("another-session")).toBeNull();
    expect(takeFirstMessage(SESSION)).toEqual({ text: "Luokittele laskut", fieldTop: 320 });
    expect(takeFirstMessage(SESSION)).toBeNull();
    expect(store.size).toBe(0);
  });

  it("survives a full page load, where only the storage is left", async () => {
    keepFirstMessage(SESSION, { text: "Luokittele laskut" });
    vi.resetModules();
    const reloaded = await import("./first-message");

    expect(reloaded.takeFirstMessage(SESSION)).toEqual({ text: "Luokittele laskut" });
    // The first copy of the module still holds it in memory; the storage does not.
    expect(store.size).toBe(0);
  });

  it("takes nothing that is not a message", () => {
    store.set(KEY, '{"text": 5}');
    expect(takeFirstMessage(SESSION)).toBeNull();
    store.set(KEY, '{"text": "   "}');
    expect(takeFirstMessage(SESSION)).toBeNull();
    store.set(KEY, "not json");
    expect(takeFirstMessage(SESSION)).toBeNull();
    expect(store.size).toBe(0);
  });

  it("drops a field position that is not a number", () => {
    store.set(KEY, '{"text": "Hei", "fieldTop": "12"}');
    expect(takeFirstMessage(SESSION)).toEqual({ text: "Hei" });
  });

  it("is carried in memory when storage is blocked", () => {
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("blocked");
      },
    });

    keepFirstMessage(SESSION, { text: "Luokittele laskut" });
    expect(takeFirstMessage(SESSION)).toEqual({ text: "Luokittele laskut" });
    expect(takeFirstMessage(SESSION)).toBeNull();
  });
});
