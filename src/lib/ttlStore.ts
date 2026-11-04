/**
 * Bounded in-memory TTL store.
 *
 * One deep module behind the many shallow per-feature Maps that previously
 * held entries with no size cap. Enforces a hard cap on entries and TTL-based
 * expiry, evicting expired entries first and then the oldest inserted.
 *
 * Value type must carry `expiresAt: number` (epoch ms). Expiry is per-entry,
 * so a single store can back maps with different TTLs.
 */
export interface Expiring {
  expiresAt: number;
}

export interface TtlStore<T extends Expiring> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  has(key: string): boolean;
  size(): number;
  /** Drop expired entries; returns count removed. */
  sweep(): number;
  clear(): void;
  /** Backing map, exposed for tests and diagnostics. */
  readonly raw: Map<string, T>;
}

export function createTtlStore<T extends Expiring>(maxSize: number): TtlStore<T> {
  const raw = new Map<string, T>();

  function sweep(): number {
    const now = Date.now();
    let dropped = 0;
    for (const [k, v] of raw) {
      if (v.expiresAt < now) {
        raw.delete(k);
        dropped++;
      }
    }
    return dropped;
  }

  function evictIfNeeded(): void {
    if (raw.size < maxSize) return;
    sweep();
    if (raw.size < maxSize) return;
    const firstKey = raw.keys().next().value;
    if (firstKey !== undefined) raw.delete(firstKey);
  }

  return {
    get(key) {
      const v = raw.get(key);
      if (v === undefined) return undefined;
      if (v.expiresAt < Date.now()) {
        raw.delete(key);
        return undefined;
      }
      return v;
    },
    set(key, value) {
      if (raw.has(key)) raw.delete(key);
      evictIfNeeded();
      raw.set(key, value);
    },
    delete(key) { raw.delete(key); },
    has(key) {
      const v = raw.get(key);
      if (v === undefined) return false;
      if (v.expiresAt < Date.now()) { raw.delete(key); return false; }
      return true;
    },
    size() { return raw.size; },
    sweep,
    clear() { raw.clear(); },
    raw,
  };
}
