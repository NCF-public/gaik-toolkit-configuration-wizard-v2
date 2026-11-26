import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_AGE_MS,
  claimUnsentBlueprint,
  discardUnsentBlueprint,
  dropUnsentBlueprint,
  keepUnsentBlueprint,
  onUnsentBlueprintsStopped,
  resumeKeepingUnsentBlueprints,
  stopKeepingUnsentBlueprints,
  sweepUnsentBlueprints,
  unsentBlueprintWaiting,
} from "./unsent-blueprint";

const SESSION = "2fa204b7";
const KEY = `gaik-wizard:unsent-blueprint:${SESSION}`;
const ME = "u_0123456789abcdef";
const SOMEONE = "u_fedcba9876543210";
const DRAFT = {
  name: "Invoices",
  description: "",
  goal: "Half the handling time",
  steps: [{ id: "s1", name: "Read", type: "ai" as const }],
};
const SHOWN = { ...DRAFT, goal: "Shorter handling time" };
const UNSENT = { blueprint: DRAFT, baseVersion: 4, pendingKey: "the save on its way" };

describe("the form's draft kept as the page goes", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.useRealTimers();
    const listeners = new Map<string, Set<(e: unknown) => void>>();
    vi.stubGlobal("window", {
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: (e: unknown) => void) => void listeners.get(type)?.delete(fn),
      dispatchEvent: (e: Event) => {
        listeners.get(e.type)?.forEach((fn) => fn(e));
        return true;
      },
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  });

  it("stays kept when it is read, held by the form that read it, until that form saves", () => {
    keepUnsentBlueprint(SESSION, ME, "tab-a", UNSENT);

    expect(unsentBlueprintWaiting(SESSION, ME, SHOWN)).toBe(true);
    expect(claimUnsentBlueprint(SESSION, ME, "tab-b")).toEqual(UNSENT);
    // A reload before the user chose finds it again.
    expect(claimUnsentBlueprint(SESSION, ME, "tab-c")).toEqual(UNSENT);
    dropUnsentBlueprint(SESSION, "tab-b");
    expect(unsentBlueprintWaiting(SESSION, ME, SHOWN)).toBe(true);
    dropUnsentBlueprint(SESSION, "tab-c");
    expect(unsentBlueprintWaiting(SESSION, ME, SHOWN)).toBe(false);
  });

  it("goes when the user takes the server's version or deletes the session", () => {
    keepUnsentBlueprint(SESSION, ME, "tab-a", UNSENT);
    discardUnsentBlueprint(SESSION);
    expect(store.has(KEY)).toBe(false);
  });

  it("is not waiting when the page shows it already, and is removed then", () => {
    keepUnsentBlueprint(SESSION, ME, "tab-a", UNSENT);

    expect(unsentBlueprintWaiting(SESSION, ME, DRAFT)).toBe(false);
    expect(store.has(KEY)).toBe(false);
  });

  it("is given only to the user who kept it, and is erased when another user reads it", () => {
    keepUnsentBlueprint(SESSION, ME, "tab-a", UNSENT);

    expect(claimUnsentBlueprint(SESSION, SOMEONE, "tab-b")).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it("is erased, not only left unread, after a day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    keepUnsentBlueprint(SESSION, ME, "tab-a", UNSENT);
    vi.setSystemTime(Date.now() + MAX_AGE_MS);

    expect(unsentBlueprintWaiting(SESSION, ME, SHOWN)).toBe(false);
    expect(store.has(KEY)).toBe(false);
  });

  it("as the app opens, erases the drafts of other users and the old ones, and keeps the user's own", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    keepUnsentBlueprint("old", ME, "tab-a", UNSENT);
    vi.setSystemTime(Date.now() + MAX_AGE_MS);
    keepUnsentBlueprint("theirs", SOMEONE, "tab-a", UNSENT);
    keepUnsentBlueprint(SESSION, ME, "tab-a", UNSENT);
    store.set("gaik-wizard:unsent-blueprint:broken", "{not json");
    store.set("gaik-wizard:something-else", "kept");

    sweepUnsentBlueprints(ME);

    expect([...store.keys()].sort()).toEqual([KEY, "gaik-wizard:something-else"].sort());
  });

  it("all go on sign-out, and the user's are not kept again until they sign in", () => {
    keepUnsentBlueprint(SESSION, ME, "tab-a", UNSENT);
    keepUnsentBlueprint("other", SOMEONE, "tab-a", UNSENT);
    store.set("gaik-wizard:something-else", "kept");
    const letGo = vi.fn();
    const stop = onUnsentBlueprintsStopped(ME, letGo);

    stopKeepingUnsentBlueprints(ME);

    expect([...store.keys()].filter((k) => k.includes("unsent-blueprint:"))).toEqual([]);
    expect(store.get("gaik-wizard:something-else")).toBe("kept");
    // The form of this tab is told, and its draft as the page goes is not kept.
    expect(letGo).toHaveBeenCalledTimes(1);
    keepUnsentBlueprint(SESSION, ME, "tab-a", UNSENT);
    expect(store.has(KEY)).toBe(false);
    // Another user's are kept as before.
    keepUnsentBlueprint("other", SOMEONE, "tab-b", UNSENT);
    expect(claimUnsentBlueprint("other", SOMEONE, "tab-b")).toEqual(UNSENT);

    resumeKeepingUnsentBlueprints(ME);
    keepUnsentBlueprint(SESSION, ME, "tab-c", UNSENT);
    expect(claimUnsentBlueprint(SESSION, ME, "tab-c")).toEqual(UNSENT);
    stop();
  });

  it("tells a form in another tab when the user signs out there", () => {
    const letGo = vi.fn();
    onUnsentBlueprintsStopped(ME, letGo);
    store.set("gaik-wizard:unsent-blueprints-stopped", JSON.stringify([SOMEONE]));
    window.dispatchEvent(Object.assign(new Event("storage"), { key: "gaik-wizard:unsent-blueprints-stopped" }));
    expect(letGo).not.toHaveBeenCalled();
    store.set("gaik-wizard:unsent-blueprints-stopped", JSON.stringify([SOMEONE, ME]));
    window.dispatchEvent(Object.assign(new Event("storage"), { key: "gaik-wizard:unsent-blueprints-stopped" }));
    expect(letGo).toHaveBeenCalledTimes(1);
  });

  it("takes nothing that is not a blueprint, and removes it", () => {
    store.set(KEY, JSON.stringify({ blueprint: { steps: "no" }, owner: ME, tab: "t", at: Date.now() }));
    expect(claimUnsentBlueprint(SESSION, ME, "tab-a")).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it("keeps nothing, and fails nothing, where storage is blocked", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked");
      },
    });
    expect(() => keepUnsentBlueprint(SESSION, ME, "tab-a", UNSENT)).not.toThrow();
    expect(unsentBlueprintWaiting(SESSION, ME, SHOWN)).toBe(false);
    expect(claimUnsentBlueprint(SESSION, ME, "tab-a")).toBeNull();
    expect(() => sweepUnsentBlueprints(ME)).not.toThrow();
    expect(() => stopKeepingUnsentBlueprints(ME)).not.toThrow();
    expect(() => resumeKeepingUnsentBlueprints(ME)).not.toThrow();
  });
});
