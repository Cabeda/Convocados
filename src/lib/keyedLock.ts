const tails = new Map<string, Promise<unknown>>();

/**
 * Run `fn` after every earlier call with the same `key` has settled, so a check-then-create on one key
 * cannot interleave with itself. In-process only: it serialises requests inside this server, which is
 * the whole write path while the database is one SQLite file on one machine.
 */
export async function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  try {
    return await run;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}
