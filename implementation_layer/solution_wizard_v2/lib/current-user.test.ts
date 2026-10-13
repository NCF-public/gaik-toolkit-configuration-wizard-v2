import { afterEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => cookiesMock,
}));

const supabaseAuthMock = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: supabaseAuthMock }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

// DEV_AUTH is read once at module import time from NEXT_PUBLIC_DEV_AUTH, so
// each scenario stubs the env first and re-imports the module fresh.
async function importFresh() {
  vi.resetModules();
  return import("@/lib/current-user");
}

describe("getCurrentUser — dev auth mode", () => {
  it("returns the user for a valid dev session cookie", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH", "true");
    cookiesMock.get.mockReturnValue({ value: "dev@gaik.local" });
    const { getCurrentUser } = await importFresh();
    expect(await getCurrentUser()).toEqual({ email: "dev@gaik.local" });
  });

  it("returns null when no dev cookie is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH", "true");
    cookiesMock.get.mockReturnValue(undefined);
    const { getCurrentUser } = await importFresh();
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns null for a cookie value that isn't a known dev user", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH", "true");
    cookiesMock.get.mockReturnValue({ value: "not-a-dev-user@example.com" });
    const { getCurrentUser } = await importFresh();
    expect(await getCurrentUser()).toBeNull();
  });

  it("never touches Supabase in dev mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH", "true");
    cookiesMock.get.mockReturnValue({ value: "dev@gaik.local" });
    const { getCurrentUser } = await importFresh();
    await getCurrentUser();
    expect(supabaseAuthMock.getUser).not.toHaveBeenCalled();
  });
});

describe("getCurrentUser — Supabase mode", () => {
  it("returns the Supabase user's email when signed in", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH", "");
    supabaseAuthMock.getUser.mockResolvedValue({ data: { user: { email: "real@gaik.local" } } });
    const { getCurrentUser } = await importFresh();
    expect(await getCurrentUser()).toEqual({ email: "real@gaik.local" });
  });

  it("returns null when Supabase has no signed-in user", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH", "");
    supabaseAuthMock.getUser.mockResolvedValue({ data: { user: null } });
    const { getCurrentUser } = await importFresh();
    expect(await getCurrentUser()).toBeNull();
  });
});
