import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { TRACE_HEADER } from "@/lib/trace-header";

export { TRACE_HEADER };

export type RequestContext = {
  traceId: string;
  /** Set once the handler knows who's calling (after requireOwnedSession etc). */
  userId?: string;
};

const als = new AsyncLocalStorage<RequestContext>();

export function newTraceId(): string {
  return randomUUID();
}

/** Run `fn` with a request-scoped context available to getContext()/getTraceId(). */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return als.getStore();
}

export function getTraceId(): string | undefined {
  return als.getStore()?.traceId;
}

/** Attach the acting user's identifier to the current request context, once known. */
export function setContextUserId(userId: string): void {
  const store = als.getStore();
  if (store) store.userId = userId;
}

/**
 * Trace id for places that never go through withLogging's AsyncLocalStorage
 * run (Server Actions, e.g. app/login/actions.ts) — middleware already put
 * it on the incoming request, so read it straight from next/headers instead.
 * Falls back to a fresh id if middleware didn't run (e.g. unit tests).
 */
export async function getIncomingTraceId(): Promise<string> {
  try {
    const store = await headers();
    return store.get(TRACE_HEADER) ?? newTraceId();
  } catch {
    // next/headers throws outside a request scope (unit tests, scripts).
    return newTraceId();
  }
}
