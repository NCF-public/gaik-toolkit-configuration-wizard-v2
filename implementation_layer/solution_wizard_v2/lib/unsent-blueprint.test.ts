import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_AGE_MS,
  dropUnsentBlueprint,
  keepUnsentBlueprint,
  takeUnsentBlueprint,
  unsentBlueprintWaiting,
} from "./unsent-blueprint";

const SESSION = "2fa204b7";
const KEY = `gaik-wizard:unsent-blueprint:${SESSION}`;
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
    vi.stubGlobal("window", {
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

  it("is taken back once, with the version it was made on and the save on its way", () => {
    keepUnsentBlueprint(SESSION, "tab-a", UNSENT);

    expect(unsentBlueprintWaiting(SESSION, SHOWN)).toBe(true);
    expect(takeUnsentBlueprint(SESSION)).toEqual(UNSENT);
    expect(takeUnsentBlueprint(SESSION)).toBeNull();
    expect(unsentBlueprintWaiting(SESSION, SHOWN)).toBe(false);
  });

  it("is not waiting when the page shows it already, and is removed then", () => {
    keepUnsentBlueprint(SESSION, "tab-a", UNSENT);

    expect(unsentBlueprintWaiting(SESSION, DRAFT)).toBe(false);
    expect(store.has(KEY)).toBe(false);
  });

  it("is dropped by the save of the form that kept it, not by another tab's", () => {
    keepUnsentBlueprint(SESSION, "tab-a", UNSENT);

    dropUnsentBlueprint(SESSION, "tab-b");
    expect(unsentBlueprintWaiting(SESSION, SHOWN)).toBe(true);
    dropUnsentBlueprint(SESSION, "tab-a");
    expect(unsentBlueprintWaiting(SESSION, SHOWN)).toBe(false);
  });

  it("is not taken back after a day, and old drafts of other sessions go as one is read", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    keepUnsentBlueprint("other", "tab-a", UNSENT);
    keepUnsentBlueprint(SESSION, "tab-a", UNSENT);
    vi.setSystemTime(Date.now() + MAX_AGE_MS);

    expect(unsentBlueprintWaiting(SESSION, SHOWN)).toBe(false);
    expect(takeUnsentBlueprint(SESSION)).toBeNull();
    expect([...store.keys()]).toEqual([]);
  });

  it("takes nothing that is not a blueprint, and removes it", () => {
    store.set(KEY, JSON.stringify({ blueprint: { steps: "no" }, tab: "t", at: Date.now() }));
    expect(takeUnsentBlueprint(SESSION)).toBeNull();
    store.set(KEY, "{not json");
    expect(takeUnsentBlueprint(SESSION)).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it("keeps nothing, and fails nothing, where storage is blocked", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked");
      },
    });
    expect(() => keepUnsentBlueprint(SESSION, "tab-a", UNSENT)).not.toThrow();
    expect(unsentBlueprintWaiting(SESSION, SHOWN)).toBe(false);
    expect(takeUnsentBlueprint(SESSION)).toBeNull();
  });
});
