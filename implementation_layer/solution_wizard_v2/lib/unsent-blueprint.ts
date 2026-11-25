import type { Blueprint } from "@/lib/mock-sessions";
import { blueprintPayloadKey } from "@/lib/blueprint-draft";
import { parseBlueprintJson } from "@/lib/blueprint-parse";

/**
 * The Blueprint form's unsaved draft, kept as the page goes.
 *
 * The form sends its draft as the page closes, but nothing is left to hear the
 * answer: a save refused then (made on a version that the save on its way had
 * moved on) lost what was typed last. The draft is kept here and taken back on
 * the session's next load, and stays kept until a save of it succeeds or the
 * user takes the server's version instead.
 *
 * It is the user's content, so its life is short and tied to them: in this
 * browser's localStorage (sessionStorage does not outlive a closed tab), with
 * the signed-in user's pseudonym (`lib/actor-id`), for at most `MAX_AGE_MS`.
 * A draft of another user or past that age is erased where it is read, and
 * all of them when the app opens (`sweepUnsentBlueprints`); a session's goes
 * with the session. Sign-out (`stopKeepingUnsentBlueprints`) erases every
 * draft and stops keeping that user's in every tab of this browser until they
 * sign in again: a form still open would otherwise keep its draft again as the
 * page goes.
 */
export type UnsentBlueprint = {
  blueprint: Blueprint;
  /** The version the draft was made on. */
  baseVersion: number | null;
  /** The payload key (`blueprintPayloadKey`) of the form's save that was on its way, if one was. */
  pendingKey: string | null;
};

type Kept = UnsentBlueprint & {
  /** The signed-in user's pseudonym: only they get it back. */
  owner: string;
  /** The form (one page load) that holds it: only its own successful save drops it. */
  tab: string;
  at: number;
};

/** How long a kept draft waits for the session to be opened again: a reload, or a tab closed that day. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PREFIX = "gaik-wizard:unsent-blueprint:";
const key = (sessionId: string) => `${PREFIX}${sessionId}`;
/** The users who signed out in this browser: no draft of theirs is kept until they are back. */
const STOPPED_KEY = "gaik-wizard:unsent-blueprints-stopped";
/** Told to the forms of this tab as sign-out begins; other tabs hear the storage change. */
const STOPPED_EVENT = "gaik-wizard:unsent-blueprints-stopped";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function remove(store: Storage, name: string): void {
  try {
    store.removeItem(name);
  } catch {
    // Storage blocked: nothing more can be done here.
  }
}

/** The draft under `name` when it is valid and fresh, else null. */
function parse(store: Storage, name: string): Kept | null {
  let data: unknown;
  try {
    data = JSON.parse(store.getItem(name) ?? "null");
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { blueprint, baseVersion, pendingKey, owner, tab, at } = data as Record<string, unknown>;
  const parsed = parseBlueprintJson(JSON.stringify(blueprint ?? null));
  if (!parsed || typeof owner !== "string" || typeof tab !== "string" || typeof at !== "number") {
    return null;
  }
  if (!(Date.now() - at < MAX_AGE_MS)) return null;
  return {
    blueprint: parsed,
    baseVersion: typeof baseVersion === "number" ? baseVersion : null,
    pendingKey: typeof pendingKey === "string" ? pendingKey : null,
    owner,
    tab,
    at,
  };
}

/** The session's draft kept for `owner`; one that is not theirs, not fresh or not valid is erased. */
function read(store: Storage, sessionId: string, owner: string): Kept | null {
  const name = key(sessionId);
  let present = false;
  try {
    present = store.getItem(name) !== null;
  } catch {
    return null;
  }
  if (!present) return null;
  const kept = parse(store, name);
  if (kept && kept.owner === owner) return kept;
  remove(store, name);
  return null;
}

function stoppedOwners(store: Storage): string[] {
  try {
    const owners: unknown = JSON.parse(store.getItem(STOPPED_KEY) ?? "[]");
    return Array.isArray(owners) ? owners.filter((o): o is string => typeof o === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Keeps the draft for the session's next load. `tab`: the form that keeps it.
 * Nothing is kept for a user who has signed out in this browser since.
 */
export function keepUnsentBlueprint(
  sessionId: string,
  owner: string,
  tab: string,
  unsent: UnsentBlueprint,
): void {
  const store = storage();
  if (!store || stoppedOwners(store).includes(owner)) return;
  try {
    const kept: Kept = { ...unsent, owner, tab, at: Date.now() };
    store.setItem(key(sessionId), JSON.stringify(kept));
  } catch {
    // Storage full or blocked: the save sent as the page goes is all there is.
  }
}

/**
 * Whether a draft is kept for this session that differs from `current`, the
 * blueprint the page shows: the workspace opens the form to take it back. One
 * the server holds already is removed.
 */
export function unsentBlueprintWaiting(sessionId: string, owner: string, current: Blueprint): boolean {
  const store = storage();
  const kept = store && read(store, sessionId, owner);
  if (!store || !kept) return false;
  if (blueprintPayloadKey(kept.blueprint) !== blueprintPayloadKey(current)) return true;
  remove(store, key(sessionId));
  return false;
}

/**
 * The kept draft, or null. It stays kept, now held by the form `tab` that read
 * it: what drops it is that form's successful save, or the user taking the
 * server's version (`discardUnsentBlueprint`).
 */
export function claimUnsentBlueprint(sessionId: string, owner: string, tab: string): UnsentBlueprint | null {
  const store = storage();
  const kept = store && read(store, sessionId, owner);
  if (!kept) return null;
  const { blueprint, baseVersion, pendingKey } = kept;
  keepUnsentBlueprint(sessionId, owner, tab, { blueprint, baseVersion, pendingKey });
  return { blueprint, baseVersion, pendingKey };
}

/** The form `tab` saved its draft: a draft it holds is on the server now. Another form's stays. */
export function dropUnsentBlueprint(sessionId: string, tab: string): void {
  const store = storage();
  if (store && parse(store, key(sessionId))?.tab === tab) remove(store, key(sessionId));
}

/** The session's kept draft goes: the user took the server's version, or deletes the session. */
export function discardUnsentBlueprint(sessionId: string): void {
  const store = storage();
  if (store) remove(store, key(sessionId));
}

function keptNames(store: Storage): string[] {
  const names: string[] = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const name = store.key(i);
      if (name?.startsWith(PREFIX)) names.push(name);
    }
  } catch {
    // Storage blocked: nothing to list.
  }
  return names;
}

/** As the app opens for `owner`: erases the drafts that are not theirs, not fresh or not valid. */
export function sweepUnsentBlueprints(owner: string): void {
  const store = storage();
  if (!store) return;
  for (const name of keptNames(store)) {
    if (parse(store, name)?.owner !== owner) remove(store, name);
  }
}

/**
 * As sign-out begins: `owner`'s drafts are no longer kept in any tab of this
 * browser (until `resumeKeepingUnsentBlueprints`), the forms of this tab are
 * told (`onUnsentBlueprintsStopped`), and every kept draft goes. Without an
 * owner (outside the signed-in pages) the drafts go all the same.
 */
export function stopKeepingUnsentBlueprints(owner: string | null): void {
  const store = storage();
  if (!store) return;
  if (owner) {
    const owners = stoppedOwners(store);
    try {
      if (!owners.includes(owner)) store.setItem(STOPPED_KEY, JSON.stringify([...owners, owner]));
    } catch {
      // Storage full or blocked: the drafts are still erased below.
    }
  }
  try {
    window.dispatchEvent(new Event(STOPPED_EVENT));
  } catch {
    // No window to tell: nothing in this tab listens.
  }
  for (const name of keptNames(store)) remove(store, name);
}

/** `owner` signed in again: their drafts are kept again. */
export function resumeKeepingUnsentBlueprints(owner: string): void {
  const store = storage();
  if (!store) return;
  const owners = stoppedOwners(store);
  if (!owners.includes(owner)) return;
  const left = owners.filter((o) => o !== owner);
  if (left.length) {
    try {
      store.setItem(STOPPED_KEY, JSON.stringify(left));
    } catch {
      // Storage blocked: they stay stopped, which loses nothing private.
    }
  } else remove(store, STOPPED_KEY);
}

/**
 * Calls `stopped` when `owner` signs out, in this tab or another of this
 * browser, so that a form lets go of the draft it holds. Returns the unsubscribe.
 */
export function onUnsentBlueprintsStopped(owner: string, stopped: () => void): () => void {
  const check = () => {
    const store = storage();
    if (store && stoppedOwners(store).includes(owner)) stopped();
  };
  const fromStorage = (e: StorageEvent) => {
    if (e.key === STOPPED_KEY) check();
  };
  window.addEventListener(STOPPED_EVENT, check);
  window.addEventListener("storage", fromStorage);
  return () => {
    window.removeEventListener(STOPPED_EVENT, check);
    window.removeEventListener("storage", fromStorage);
  };
}
