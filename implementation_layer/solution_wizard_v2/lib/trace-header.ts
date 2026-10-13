/**
 * Just the header name, split out from lib/request-context.ts so that
 * Edge runtime code (middleware.ts) can reference it without pulling in
 * node:crypto / node:async_hooks, which webpack can't bundle for Edge.
 */
export const TRACE_HEADER = "x-trace-id";
