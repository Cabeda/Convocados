import { normalizeForMatch } from "./stringMatch";

/** The little of `Storage` this needs, so a test can hand it a plain object. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface Entry { name: string; at: number }

const KEEP = 60;
/** A name stays "mine" for three days: a weekly game's list is gone by then, and next week's Ana is someone else. */
const TTL_MS = 3 * 86_400_000;
const keyOf = (eventId: string) => `added-here:${eventId}`;
const browserStore = (): KeyValueStore | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);

function read(eventId: string, store: KeyValueStore | undefined): Entry[] {
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(keyOf(eventId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((e): e is Entry => !!e && typeof e.name === "string" && typeof e.at === "number") : [];
  } catch { return []; }
}

function write(eventId: string, entries: Entry[], store: KeyValueStore | undefined) {
  try { store?.setItem(keyOf(eventId), JSON.stringify(entries.slice(-KEEP))); } catch { /* storage full or off: the visitor just loses the shortcut */ }
}

/**
 * Names added to an event from THIS browser, so a signed-out visitor can take back the people they added and
 * nobody else's. The server lets anyone take an anonymous row off the list, so the page narrows it. The server
 * does not give a new row's id back, so the name — compared without case or accents — is what is remembered.
 */
export function rememberAdded(eventId: string, name: string, now = Date.now(), store: KeyValueStore | undefined = browserStore()) {
  const key = normalizeForMatch(name);
  write(eventId, [...read(eventId, store).filter((e) => normalizeForMatch(e.name) !== key), { name, at: now }], store);
}

export function forgetAdded(eventId: string, name: string, store: KeyValueStore | undefined = browserStore()) {
  const key = normalizeForMatch(name);
  write(eventId, read(eventId, store).filter((e) => normalizeForMatch(e.name) !== key), store);
}

/** Every name this browser added to the event and has not forgotten, in the form `isAddedHere` compares. */
export function addedNamesHere(eventId: string, now = Date.now(), store: KeyValueStore | undefined = browserStore()): ReadonlySet<string> {
  return new Set(read(eventId, store).filter((e) => now - e.at < TTL_MS).map((e) => normalizeForMatch(e.name)));
}

export function isAddedHere(eventId: string, name: string, now = Date.now(), store: KeyValueStore | undefined = browserStore()): boolean {
  const key = normalizeForMatch(name);
  return read(eventId, store).some((e) => now - e.at < TTL_MS && normalizeForMatch(e.name) === key);
}
