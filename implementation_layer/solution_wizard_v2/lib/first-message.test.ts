import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropFirstMessage, keepFirstMessage, markFirstMessageSent, pendingFirstMessage } from "./first-message";

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
    dropFirstMessage(SESSION);
    vi.unstubAllGlobals();
  });

  it("is read by the session it was kept for, and sent by the first reading only", () => {
    keepFirstMessage(SESSION, { text: "Luokittele laskut", fieldTop: 320 });

    expect(pendingFirstMessage("another-session")).toBeNull();
    expect(pendingFirstMessage(SESSION)).toEqual({ text: "Luokittele laskut", fieldTop: 320, sentBefore: false });
    // A second reading (the page mounted again) must not send it again.
    expect(pendingFirstMessage(SESSION)).toEqual({ text: "Luokittele laskut", fieldTop: 320, sentBefore: true });
  });

  it("held back, is not sent by its reading: every reading finds it still waiting", () => {
    // The chat holds it for the recording answer; the page may be loaded again meanwhile.
    keepFirstMessage(SESSION, { text: "Luokittele laskut", fieldTop: 320 });

    expect(pendingFirstMessage(SESSION, { hold: true })).toEqual({
      text: "Luokittele laskut",
      fieldTop: 320,
      sentBefore: false,
    });
    // Loaded again: it still waits, but no longer arrives from the start view's field.
    expect(pendingFirstMessage(SESSION, { hold: true })).toEqual({ text: "Luokittele laskut", sentBefore: false });
  });

  it("held back, counts as sent from the moment the chat says it went out", () => {
    keepFirstMessage(SESSION, { text: "Luokittele laskut", fieldTop: 320 });
    pendingFirstMessage(SESSION, { hold: true });

    markFirstMessageSent(SESSION);

    expect(pendingFirstMessage(SESSION, { hold: true })).toEqual({ text: "Luokittele laskut", sentBefore: true });
    expect(pendingFirstMessage(SESSION)?.sentBefore).toBe(true);
  });

  it("marking a message that is not there, or already sent, changes nothing", () => {
    markFirstMessageSent(SESSION);
    expect(pendingFirstMessage(SESSION)).toBeNull();

    keepFirstMessage(SESSION, { text: "Luokittele laskut" });
    pendingFirstMessage(SESSION);
    markFirstMessageSent(SESSION);
    expect(pendingFirstMessage(SESSION)).toEqual({ text: "Luokittele laskut", sentBefore: true });
  });

  it("is still there after a reload when the wizard refused the turn, marked as sent before", async () => {
    keepFirstMessage(SESSION, { text: "Luokittele laskut" });
    expect(pendingFirstMessage(SESSION)).toEqual({ text: "Luokittele laskut", sentBefore: false });
    // The turn was refused: nothing dropped the message. A full page load
    // leaves only the storage.
    vi.resetModules();
    const reloaded = await import("./first-message");

    expect(reloaded.pendingFirstMessage(SESSION)).toEqual({ text: "Luokittele laskut", sentBefore: true });
    expect(store.has(KEY)).toBe(true);
    reloaded.dropFirstMessage(SESSION);
  });

  it("is gone once the wizard has started on a turn", async () => {
    keepFirstMessage(SESSION, { text: "Luokittele laskut" });
    pendingFirstMessage(SESSION);
    dropFirstMessage(SESSION);

    expect(store.size).toBe(0);
    expect(pendingFirstMessage(SESSION)).toBeNull();
    vi.resetModules();
    expect((await import("./first-message")).pendingFirstMessage(SESSION)).toBeNull();
  });

  it("survives a full page load before it was read, where only the storage is left", async () => {
    keepFirstMessage(SESSION, { text: "Luokittele laskut" });
    vi.resetModules();
    const reloaded = await import("./first-message");

    expect(reloaded.pendingFirstMessage(SESSION)).toEqual({ text: "Luokittele laskut", sentBefore: false });
    reloaded.dropFirstMessage(SESSION);
  });

  it("takes nothing that is not a message, and removes it", () => {
    store.set(KEY, '{"text": 5}');
    expect(pendingFirstMessage(SESSION)).toBeNull();
    store.set(KEY, '{"text": "   "}');
    expect(pendingFirstMessage(SESSION)).toBeNull();
    store.set(KEY, "not json");
    expect(pendingFirstMessage(SESSION)).toBeNull();
    expect(store.size).toBe(0);
  });

  it("drops a field position that is not a number", () => {
    store.set(KEY, '{"text": "Hei", "fieldTop": "12"}');
    expect(pendingFirstMessage(SESSION)).toEqual({ text: "Hei", sentBefore: false });
  });

  it("is carried in memory when storage is blocked, and sent once there too", () => {
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("blocked");
      },
    });

    keepFirstMessage(SESSION, { text: "Luokittele laskut" });
    expect(pendingFirstMessage(SESSION)).toEqual({ text: "Luokittele laskut", sentBefore: false });
    expect(pendingFirstMessage(SESSION)).toEqual({ text: "Luokittele laskut", sentBefore: true });
    dropFirstMessage(SESSION);
    expect(pendingFirstMessage(SESSION)).toBeNull();
  });
});
