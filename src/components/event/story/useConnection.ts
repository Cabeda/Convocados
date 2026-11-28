import { useCallback, useRef, useState } from "react";

/** One failed read can be a blip; this many in a row is a lost connection. */
export const OFFLINE_AFTER_FAILURES = 2;

export interface Connection {
  /** When the page last heard from the server, while it is out of reach; null while it is reachable. */
  offlineSince: number | null;
  /** Report one read of the event: it arrived, or it did not. */
  report: (ok: boolean) => void;
}

/**
 * Is the server reachable? Only consecutive failed reads count, so a single
 * dropped poll says nothing. The page keeps what it had; this only tells the
 * viewer that what they see is not live.
 */
export function useConnection(): Connection {
  const failures = useRef(0);
  const lastOk = useRef<number | null>(null);
  const [offlineSince, setOfflineSince] = useState<number | null>(null);

  const report = useCallback((ok: boolean) => {
    if (ok) {
      failures.current = 0;
      lastOk.current = Date.now();
      setOfflineSince(null);
      return;
    }
    failures.current += 1;
    if (failures.current >= OFFLINE_AFTER_FAILURES && lastOk.current !== null) {
      setOfflineSince((was) => was ?? lastOk.current);
    }
  }, []);

  return { offlineSince, report };
}
