import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";
import { JSON_ROUTE_CSP } from "./lib/csp";

// The BPMN save route (/api/sessions/[id]/bpmn/sync) lints the diagram by
// spawning scripts/lint-bpmn.mjs as a child process. Next's standalone tracer
// only bundles node_modules it sees imported from the app graph, and a spawned
// script is invisible to it, so bpmnlint + bpmn-moddle and their transitive
// deps were dropped from the image and the linter could not start on Rahti.
// List the script, its .bpmnlintrc, and the exact dependency closure (derived
// from package-lock.json) so the standalone image ships everything the child
// process requires and linting actually runs. The route also tolerates a
// missing linter (it logs and proceeds), so this only restores validation.
const BPMN_LINT_TRACE = [
  "./scripts/lint-bpmn.mjs",
  "./.bpmnlintrc",
  ...[
    "@bpmn-io/moddle-utils",
    "ansi-colors",
    "bpmn-moddle",
    "bpmnlint",
    "bpmnlint-utils",
    "cli-table",
    "color-support",
    "colors",
    "globalyzer",
    "globrex",
    "min-dash",
    "moddle",
    "moddle-xml",
    "mri",
    "pluralize",
    "saxen",
    "tiny-glob",
  ].map((pkg) => `./node_modules/${pkg}/**`),
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Stop advertising the stack in every response (#133).
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/sessions/[id]/bpmn/sync": BPMN_LINT_TRACE,
  },
  async headers() {
    return [
      { source: "/:path*", headers: [...securityHeaders] },
      // The middleware sets a nonce CSP on every request it sees (lib/csp.ts).
      // Its matcher leaves out the file uploads (middleware.ts), so they get a
      // static one here; they answer JSON and load nothing.
      ...["/api/sessions/:id/poc/input", "/api/sessions/:id/cases/:caseId/inputs"].map(
        (source) => ({
          source,
          headers: [{ key: "Content-Security-Policy", value: JSON_ROUTE_CSP }],
        }),
      ),
    ];
  },
};

export default nextConfig;
