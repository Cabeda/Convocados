import { useCallback, useRef, useState } from "react";
import { cheer } from "./styles";

export interface OptimisticStep {
  /** Show the finished state at once. */
  apply: () => void;
  /** The request. Reject to say it failed. */
  request: () => Promise<unknown>;
  /** Put things back the way they were. */
  revert: () => void;
}

/**
 * One request that is believed before it is confirmed: `apply` runs first so the
 * row hides at once, `revert` runs if the server refuses. A second tap while the
 * first is in flight does nothing, so a double tap cannot post twice.
 */
export function useOptimisticAction() {
  const inflight = useRef(false);
  const [failed, setFailed] = useState(false);

  const run = useCallback(async ({ apply, request, revert }: OptimisticStep): Promise<boolean> => {
    if (inflight.current) return false;
    inflight.current = true;
    setFailed(false);
    apply();
    cheer();
    try {
      await request();
      return true;
    } catch {
      revert();
      setFailed(true);
      return false;
    } finally {
      inflight.current = false;
    }
  }, []);

  return { run, failed, clearFailed: useCallback(() => setFailed(false), []) };
}
