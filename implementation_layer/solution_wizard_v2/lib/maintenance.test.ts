import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RETRY_AFTER_S,
  MAINTENANCE_HEADER,
  maintenanceGate,
  maintenancePage,
  maintenanceSettings,
  plannedBannerText,
  retryAfterSeconds,
} from "./maintenance";
import { isMaintenanceResponse, watchForMaintenance } from "./maintenance-watch";

const NOW = new Date("2026-11-26T14:00:00Z");
const settingsOf = (env: Record<string, string>) => maintenanceSettings(env as NodeJS.ProcessEnv);
const on = (extra: Record<string, string> = {}) => settingsOf({ WIZARD_MAINTENANCE: "on", ...extra });

describe("maintenance settings", () => {
  it("is off unless the flag says on or planned", () => {
    expect(settingsOf({}).state).toBe("off");
    expect(settingsOf({ WIZARD_MAINTENANCE: "true" }).state).toBe("off");
    expect(settingsOf({ WIZARD_MAINTENANCE: " ON " }).state).toBe("on");
    expect(settingsOf({ WIZARD_MAINTENANCE: "planned" }).state).toBe("planned");
  });

  it("reads the list as lower-case addresses and drops a time it cannot read", () => {
    const settings = on({ WIZARD_MAINTENANCE_ALLOW: " Ops@Gaik.local ,, second@gaik.local", WIZARD_MAINTENANCE_UNTIL: "soon" });
    expect(settings.allow).toEqual(["ops@gaik.local", "second@gaik.local"]);
    expect(settings.until).toBeNull();
  });

  it("keeps the operator's message short", () => {
    expect(on({ WIZARD_MAINTENANCE_MESSAGE: "x".repeat(2000) }).message).toHaveLength(500);
    expect(on({ WIZARD_MAINTENANCE_MESSAGE: "   " }).message).toBeNull();
  });
});

describe("maintenance gate", () => {
  it("lets everything on while the mode is off or only planned", () => {
    expect(maintenanceGate("/", null, settingsOf({}), NOW)).toBeNull();
    expect(maintenanceGate("/api/sessions", null, settingsOf({ WIZARD_MAINTENANCE: "planned" }), NOW)).toBeNull();
  });

  it("answers a page with the maintenance page and 503", async () => {
    const res = maintenanceGate("/sessions/abc", "someone@gaik.local", on(), NOW);
    expect(res?.status).toBe(503);
    expect(res?.headers.get("content-type")).toContain("text/html");
    expect(res?.headers.get(MAINTENANCE_HEADER)).toBe("on");
    expect(res?.headers.get("cache-control")).toBe("no-store");
    const html = await res!.text();
    expect(html).toContain("Palvelussa on huoltokatko");
    expect(html).toContain("The service is down for maintenance");
  });

  it("answers an API call with 503 JSON and Retry-After", async () => {
    const res = maintenanceGate("/api/sessions/abc/chat", null, on({ WIZARD_MAINTENANCE_UNTIL: "2026-11-26T15:00:00Z" }), NOW);
    expect(res?.status).toBe(503);
    expect(res?.headers.get("retry-after")).toBe("3600");
    expect(await res!.json()).toMatchObject({ maintenance: true });
    expect(isMaintenanceResponse(res!)).toBe(true);
  });

  it("keeps the sign-in pages and /privacy open, so an operator can sign in", () => {
    expect(maintenanceGate("/login", null, on(), NOW)).toBeNull();
    expect(maintenanceGate("/login/anything", null, on(), NOW)).toBeNull();
    expect(maintenanceGate("/privacy", null, on(), NOW)).toBeNull();
  });

  it("lets an address on the list through, and nobody signed out", () => {
    const settings = on({ WIZARD_MAINTENANCE_ALLOW: "ops@gaik.local" });
    expect(maintenanceGate("/api/sessions", "OPS@gaik.local", settings, NOW)).toBeNull();
    expect(maintenanceGate("/api/sessions", "other@gaik.local", settings, NOW)?.status).toBe(503);
    expect(maintenanceGate("/api/sessions", null, settings, NOW)?.status).toBe(503);
  });
});

describe("Retry-After", () => {
  it("counts down to the end time, and falls back once it has passed or is missing", () => {
    expect(retryAfterSeconds(on({ WIZARD_MAINTENANCE_UNTIL: "2026-11-26T14:00:30.200Z" }), NOW)).toBe(31);
    expect(retryAfterSeconds(on({ WIZARD_MAINTENANCE_UNTIL: "2026-11-26T13:00:00Z" }), NOW)).toBe(DEFAULT_RETRY_AFTER_S);
    expect(retryAfterSeconds(on(), NOW)).toBe(DEFAULT_RETRY_AFTER_S);
  });
});

describe("maintenance page", () => {
  it("shows the end time in Finnish time and the message as plain text", () => {
    const html = maintenancePage(
      on({ WIZARD_MAINTENANCE_UNTIL: "2026-11-26T16:00:00Z", WIZARD_MAINTENANCE_MESSAGE: "<script>alert(1)</script> & päivitys" }),
    );
    // 16:00 UTC is 18:00 in Helsinki in November.
    expect(html).toMatch(/Arvioitu päättymisaika: 26\.11\.2026[^<]*18[.:]00/);
    expect(html).toMatch(/Expected to end: 26\/11\/2026[^<]*18:00/);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; päivitys");
  });

  it("loads nothing and runs no script", () => {
    const html = maintenancePage(on());
    expect(html).not.toMatch(/<script|<link|src=/);
    expect(html).toContain('http-equiv="refresh"');
  });
});

describe("planned-break banner", () => {
  it("shows only while a break is planned, in the reader's language", () => {
    expect(plannedBannerText(on(), "fi")).toBeNull();
    expect(plannedBannerText(settingsOf({}), "fi")).toBeNull();
    const planned = settingsOf({
      WIZARD_MAINTENANCE: "planned",
      WIZARD_MAINTENANCE_START: "2026-11-27T16:00:00Z",
      WIZARD_MAINTENANCE_MESSAGE: "Päivitämme kirjautumisen.",
    });
    expect(plannedBannerText(planned, "fi")).toMatch(/^Palveluun on tulossa huoltokatko 27\.11\.2026.*alkaen\..*Päivitämme kirjautumisen\.$/);
    expect(plannedBannerText(planned, "en")).toMatch(/^A maintenance break begins at 27\/11\/2026/);
  });
});

describe("watching for the break in an open page", () => {
  afterEach(() => vi.restoreAllMocks());

  const refusal = () => new Response("{}", { status: 503, headers: { [MAINTENANCE_HEADER]: "on" } });

  it("calls back once on a maintenance refusal and hands every response back", async () => {
    const responses = [new Response("ok"), refusal(), refusal()];
    const host = { fetch: vi.fn(async () => responses.shift()!) as unknown as typeof fetch };
    const onMaintenance = vi.fn();
    watchForMaintenance(host, onMaintenance);
    expect((await host.fetch("/api/a")).status).toBe(200);
    expect(onMaintenance).not.toHaveBeenCalled();
    expect((await host.fetch("/api/b")).status).toBe(503);
    await host.fetch("/api/c");
    expect(onMaintenance).toHaveBeenCalledTimes(1);
  });

  it("leaves an ordinary 503 alone", async () => {
    const host = { fetch: vi.fn(async () => new Response("busy", { status: 503 })) as unknown as typeof fetch };
    const onMaintenance = vi.fn();
    watchForMaintenance(host, onMaintenance);
    await host.fetch("/api/a");
    expect(onMaintenance).not.toHaveBeenCalled();
  });

  it("wraps only once and puts the original back", () => {
    const original = vi.fn() as unknown as typeof fetch;
    const host = { fetch: original };
    const undo = watchForMaintenance(host, () => {});
    const wrapped = host.fetch;
    watchForMaintenance(host, () => {});
    expect(host.fetch).toBe(wrapped);
    undo();
    expect(host.fetch).toBe(original);
  });
});
