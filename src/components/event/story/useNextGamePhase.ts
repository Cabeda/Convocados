/* eslint-disable react-hooks/set-state-in-effect -- the phase is re-read when the game's times change and when the tab comes back. */
import { useEffect, useState } from "react";
import { nextGamePhase, phaseChangeDelay, type NextGamePhase } from "~/lib/nextGame";

/**
 * The phase of the next game ("open", "live", "signupsSoon", …) for the parts of the page that only care
 * about the phase. One timeout to kickoff, one to the end: the page does not re-render every minute
 * the way the countdown does. Asleep while the tab is hidden; caught up the moment it is shown.
 */
export function useNextGamePhase(startMs: number, durationMinutes: number, weekly: boolean, cancelled: boolean): NextGamePhase {
  const endMs = startMs + durationMinutes * 60_000;
  const read = () => nextGamePhase({ now: Date.now(), startMs, durationMinutes, weekly, cancelled });
  const [phase, setPhase] = useState<NextGamePhase>(read);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      const delay = phaseChangeDelay(Date.now(), startMs, endMs);
      if (delay === null) return;
      timer = setTimeout(() => { setPhase(read()); schedule(); }, delay);
    };
    const onVisibility = () => { if (!document.hidden) setPhase(read()); schedule(); };
    setPhase(read());
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `read` is rebuilt from these same values
  }, [startMs, endMs, weekly, cancelled]);

  return phase;
}
