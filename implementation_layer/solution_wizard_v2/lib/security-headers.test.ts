import { describe, expect, it } from "vitest";
import { buildSecurityHeaders, securityHeaders } from "./security-headers";

const byKey = Object.fromEntries(securityHeaders.map((h) => [h.key, h.value]));
const csp = byKey["Content-Security-Policy"];

describe("security response headers (#133)", () => {
  it.each([
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Content-Security-Policy",
  ])("sets %s", (key) => {
    expect(byKey[key]).toBeTruthy();
  });

  it("blocks framing for both old and modern browsers", () => {
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("confines connections, forms and base URIs to the same origin", () => {
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  it("leaves HSTS to the route, which also covers the router's error pages", () => {
    expect(byKey["Strict-Transport-Security"]).toBeUndefined();
  });

  it("allows the blob/data image sources bpmn-js and next/font need", () => {
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("font-src 'self' data:");
  });

  // Guards the documented tradeoff: the CSP is knowingly permissive on scripts
  // because Next.js and bpmn-js need it. If someone tightens this, it should be
  // updated together with a browser check of the workflow canvas — not silently
  // deleted because "the test failed".
  it("documents the deliberate script/style relaxations", () => {
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("allows eval only for the development server, never in production (T6)", () => {
    const cspFor = (env: string) =>
      Object.fromEntries(buildSecurityHeaders(env).map((h) => [h.key, h.value]))[
        "Content-Security-Policy"
      ];
    expect(cspFor("production")).toContain("script-src 'self' 'unsafe-inline';");
    expect(cspFor("production")).not.toContain("'unsafe-eval'");
    expect(cspFor("test")).not.toContain("'unsafe-eval'");
    expect(cspFor("development")).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });
});
