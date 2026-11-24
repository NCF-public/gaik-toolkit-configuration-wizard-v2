import type { Blueprint } from "@/lib/mock-sessions";
import { blueprintPayloadKey } from "@/lib/blueprint-draft";
import { parseBlueprintJson } from "@/lib/blueprint-parse";

/**
 * The Blueprint form's unsaved draft, kept as the page goes.
 *
 * The form sends its draft as the page closes, but nothing is left to hear the
 * answer: a save refused then (made on a version that the save on its way had
 * moved on, or while the wizard replied) lost what was typed last. The draft
 * is kept here until the form reads it on the session's next load and takes it
 * back. In localStorage, so that it outlives a closed tab, which sessionStorage
 * does not: on this browser only, and for at most `MAX_AGE_MS`, as it is the
 * user's content. It is removed when the form reads or saves it.
 */
export type UnsentBlueprint = {
  blueprint: Blueprint;
  /** The version the draft was made on. */
  baseVersion: number | null;
  /** The payload key (`blueprintPayloadKey`) of the form's save that was on its way, if one was. */
  pendingKey: string | null;
};

type Kept = UnsentBlueprint & {
  /** The form (one page load) that kept it: only its own successful save drops it. */
  tab: string;
  at: number;
};

/** How long a kept draft waits for the session to be opened again: a reload, or a tab closed that day. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PREFIX = "gaik-wizard:unsent-blueprint:";
const key = (sessionId: string) => `${PREFIX}${sessionId}`;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(store: Storage, name: string): Kept | null {
  let data: unknown;
  try {
    data = JSON.parse(store.getItem(name) ?? "null");
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { blueprint, baseVersion, pendingKey, tab, at } = data as Record<string, unknown>;
  const parsed = parseBlueprintJson(JSON.stringify(blueprint ?? null));
  if (!parsed || typeof tab !== "string" || typeof at !== "number") return null;
  if (!(Date.now() - at < MAX_AGE_MS)) return null;
  return {
    blueprint: parsed,
    baseVersion: typeof baseVersion === "number" ? baseVersion : null,
    pendingKey: typeof pendingKey === "string" ? pendingKey : null,
    tab,
    at,
  };
}

/** Keeps the draft for the session's next load. `tab`: the form that keeps it. */
export function keepUnsentBlueprint(sessionId: string, tab: string, unsent: UnsentBlueprint): void {
  try {
    storage()?.setItem(key(sessionId), JSON.stringify({ ...unsent, tab, at: Date.now() } satisfies Kept));
  } catch {
    // Storage full or blocked: the save sent as the page goes is all there is.
  }
}

/**
 * Whether a draft is kept for this session that differs from `current`, the
 * blueprint the page shows: the workspace opens the form to take it back. One
 * the server holds already is removed.
 */
export function unsentBlueprintWaiting(sessionId: string, current: Blueprint): boolean {
  const store = storage();
  if (!store) return false;
  const kept = read(store, key(sessionId));
  if (!kept) return false;
  if (blueprintPayloadKey(kept.blueprint) !== blueprintPayloadKey(current)) return true;
  try {
    store.removeItem(key(sessionId));
  } catch {
    // Storage blocked: the form compares it again.
  }
  return false;
}

/**
 * The kept draft, removed as it is read; null when there is none, it is no
 * blueprint or it is older than `MAX_AGE_MS`. Drafts of other sessions that
 * are that old go too.
 */
export function takeUnsentBlueprint(sessionId: string): UnsentBlueprint | null {
  const store = storage();
  if (!store) return null;
  try {
    const kept = read(store, key(sessionId));
    store.removeItem(key(sessionId));
    for (let i = store.length - 1; i >= 0; i -= 1) {
      const name = store.key(i);
      if (name?.startsWith(PREFIX) && read(store, name) === null) store.removeItem(name);
    }
    if (!kept) return null;
    const { blueprint, baseVersion, pendingKey } = kept;
    return { blueprint, baseVersion, pendingKey };
  } catch {
    return null;
  }
}

/** The form `tab` saved its draft: a draft it kept is on the server now. Another form's stays. */
export function dropUnsentBlueprint(sessionId: string, tab: string): void {
  const store = storage();
  if (!store) return;
  try {
    if (read(store, key(sessionId))?.tab === tab) store.removeItem(key(sessionId));
  } catch {
    // Storage blocked: nothing was kept.
  }
}
