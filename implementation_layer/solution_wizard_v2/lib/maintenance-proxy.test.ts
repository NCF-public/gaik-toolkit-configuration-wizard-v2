// Maintenance mode as the proxy applies it, in the dev sign-in and in the
// Supabase sign-in (lib/supabase/middleware). The proxy sign-in uses the same
// gate on the address of the verified token (proxy.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase-auth")>();
  return { ...actual, devAuthActive: vi.fn(() => true), hasWizardAccess: vi.fn(async () => true) };
});
const getUser = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

import { proxy } from "@/proxy";
import { DEV_COOKIE } from "@/lib/auth";
import { signDevSession } from "@/lib/dev-session";
import { devAuthActive } from "@/lib/supabase-auth";
import { updateSession } from "@/lib/supabase/middleware";

async function asDev(path: string, email: string | null) {
  const headers: Record<string, string> = {};
  if (email) headers.cookie = `${DEV_COOKIE}=${encodeURIComponent(await signDevSession(email))}`;
  return proxy(new NextRequest(`http://localhost${path}`, { headers }));
}

beforeEach(() => {
  vi.stubEnv("DEV_AUTH_SECRET", "test-secret");
  vi.stubEnv("WIZARD_MAINTENANCE", "on");
  // The built-in local dev accounts: dev2 operates, dev is a user.
  vi.stubEnv("WIZARD_MAINTENANCE_ALLOW", "dev2@gaik.local");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(devAuthActive).mockReturnValue(true);
});

describe("maintenance mode in the proxy, dev sign-in", () => {
  it("shows the maintenance page to a signed-in user who is not on the list", async () => {
    const res = await asDev("/sessions/abc", "dev@gaik.local");
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("Palvelussa on huoltokatko");
    // The policy goes on this answer too.
    expect(res.headers.get("content-security-policy")).toBeTruthy();
    expect(res.headers.get("x-trace-id")).toBeTruthy();
  });

  it("refuses an API call with 503, also signed out", async () => {
    const res = await asDev("/api/sessions", null);
    expect(res.status).toBe(503);
    expect(res.headers.get("x-wizard-maintenance")).toBe("on");
  });

  it("lets an operator on the list in", async () => {
    const res = await asDev("/sessions/abc", "dev2@gaik.local");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("keeps the sign-in page open", async () => {
    const res = await asDev("/login", null);
    expect(res.status).toBe(200);
  });

  it("changes nothing once the mode is off", async () => {
    vi.stubEnv("WIZARD_MAINTENANCE", "");
    expect((await asDev("/sessions/abc", "dev@gaik.local")).status).toBe(200);
    // Signed out goes to the sign-in page as before.
    expect((await asDev("/sessions/abc", null)).status).toBe(307);
  });
});

describe("maintenance mode in the Supabase sign-in", () => {
  beforeEach(() => {
    vi.stubEnv("WIZARD_SUPABASE_URL", "https://supabase.example.test");
    vi.stubEnv("WIZARD_SUPABASE_KEY", "public-anon-key");
    getUser.mockReset();
  });

  it("refuses a user who is not on the list", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "user@gaik.local" } } });
    const res = await updateSession(new NextRequest("http://localhost/api/sessions"));
    expect(res.status).toBe(503);
  });

  it("lets an operator on the list on to the access check", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u2", email: "Dev2@gaik.local" } } });
    const res = await updateSession(new NextRequest("http://localhost/api/sessions"));
    expect(res.status).toBe(200);
  });

  it("shows the maintenance page rather than the sign-in page to someone signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await updateSession(new NextRequest("http://localhost/"));
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});
