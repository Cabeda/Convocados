/* eslint-disable react-hooks/set-state-in-effect -- the clock re-reads Date.now() when the game's times change and when the tab comes back. */
import { useEffect, useState } from "react";
import { nextTickDelay } from "~/lib/nextGame";

/**
 * The current time for the Next game block, kept fresh by ONE timeout to the next moment
 * the block can change (the countdown opening, its minute flipping, kickoff, the end) — not
 * by a ticker. It sleeps while the tab is hidden and catches up the moment it is shown again.
 */
export function useNextGameClock(startMs: number, endMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      const delay = nextTickDelay(Date.now(), startMs, endMs);
      if (delay === null) return;
      timer = setTimeout(() => { setNow(Date.now()); schedule(); }, delay);
    };
    const onVisibility = () => {
      if (!document.hidden) setNow(Date.now());
      schedule();
    };
    setNow(Date.now());
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [startMs, endMs]);

  return now;
}
