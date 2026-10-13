/**
 * Baseline security response headers (#133).
 *
 * The deployed app previously sent none of these — measured against the Rahti
 * staging deploy on 26 Aug 2026, which returned only `x-powered-by`,
 * `cache-control` and `content-type`.
 *
 * Lives here rather than inline in next.config.ts so the policy is testable
 * and the config stays thin.
 *
 * On CSP: this is deliberately NOT a strict policy. Next.js injects an inline
 * bootstrap script and bpmn-js writes inline styles into the diagram canvas,
 * so `script-src 'self'` alone breaks the workflow tab. Tightening to nonces
 * needs a middleware pass and is scoped out of this ticket. What is here still
 * blocks what actually matters for this app: loading code or styles from a
 * foreign origin, being framed, and posting a form off-site.
 */
export const securityHeaders = [
  // No Strict-Transport-Security here on purpose. It is set at the OpenShift
  // route instead (haproxy.router.openshift.io/hsts_header), which also covers
  // the router's own error pages — a response the app never gets to emit. Two
  // sources for one header would only drift apart.
  // Clickjacking. `frame-ancestors` below is the modern equivalent; both are
  // set because older browsers ignore the CSP directive.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 'unsafe-inline'/'unsafe-eval': required by Next.js's own bootstrap.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // 'unsafe-inline': bpmn-js sets element styles directly on the canvas.
      "style-src 'self' 'unsafe-inline'",
      // data:/blob: — bpmn-js exports diagrams as blob URLs, next/font inlines.
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // Same-origin only: the browser never talks to wizard_api directly, all
      // API traffic goes through this app's own server-side proxy.
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
] as const;
