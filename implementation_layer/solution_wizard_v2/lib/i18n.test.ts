import { describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => cookiesMock,
}));

import { DEFAULT_LOCALE, LOCALES, getI18n, getLocale } from "@/lib/i18n";

describe("getLocale", () => {
  it("defaults to the default locale when no cookie is set", async () => {
    cookiesMock.get.mockReturnValue(undefined);
    expect(await getLocale()).toBe(DEFAULT_LOCALE);
  });

  it("honours a valid locale cookie", async () => {
    cookiesMock.get.mockReturnValue({ value: "en" });
    expect(await getLocale()).toBe("en");
  });

  it("falls back to the default for an unrecognised cookie value", async () => {
    cookiesMock.get.mockReturnValue({ value: "sv" });
    expect(await getLocale()).toBe(DEFAULT_LOCALE);
  });
});

describe("getI18n", () => {
  it("returns the dict matching the current locale", async () => {
    cookiesMock.get.mockReturnValue({ value: "en" });
    const { locale, t } = await getI18n();
    expect(locale).toBe("en");
    expect(t.appName).toBe("GAIK Solution Wizard");
  });

  it("every locale's dict exposes the exact same key set (no missing translations)", async () => {
    const dicts = await Promise.all(
      LOCALES.map(async (loc) => {
        cookiesMock.get.mockReturnValue({ value: loc });
        return (await getI18n()).t;
      }),
    );
    const [first, ...rest] = dicts.map((d) => Object.keys(d).sort());
    for (const keys of rest) {
      expect(keys).toEqual(first);
    }
  });

  it("every locale's phases array has the same length (13 wizard steps)", async () => {
    for (const loc of LOCALES) {
      cookiesMock.get.mockReturnValue({ value: loc });
      const { t } = await getI18n();
      expect(t.phases).toHaveLength(13);
      expect(t.phases.every((p) => typeof p === "string" && p.length > 0)).toBe(true);
    }
  });

  it("every locale defines all four gate statuses", async () => {
    for (const loc of LOCALES) {
      cookiesMock.get.mockReturnValue({ value: loc });
      const { t } = await getI18n();
      expect(Object.keys(t.gates).sort()).toEqual(["approved", "locked", "pending", "rejected"]);
    }
  });
});
