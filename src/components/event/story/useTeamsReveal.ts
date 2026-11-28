/* eslint-disable react-hooks/set-state-in-effect -- the reveal starts when the teams appear and ends on a timer. */
import { useEffect, useRef, useState } from "react";

/** How long the block takes to unfold and its names to fade in; after this the page is plain again. */
const REVEAL_MS = 700;

/**
 * True for a moment when the teams APPEAR while the page is open (the 16th person joined, or the organizer drew),
 * never on the first read: someone opening the page to teams that were drawn yesterday sees them, still.
 * `announce` stays true while the teams are there, so a polite live region can say "Teams are ready" once.
 */
export function useTeamsReveal(hasTeams: boolean): { reveal: boolean; announce: boolean } {
  const before = useRef(hasTeams);
  const [reveal, setReveal] = useState(false);
  const [announce, setAnnounce] = useState(false);

  useEffect(() => {
    const appeared = hasTeams && !before.current;
    before.current = hasTeams;
    if (appeared) { setReveal(true); setAnnounce(true); }
    if (!hasTeams) { setReveal(false); setAnnounce(false); }
  }, [hasTeams]);

  useEffect(() => {
    if (!reveal) return;
    const timer = setTimeout(() => setReveal(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [reveal]);

  return { reveal, announce };
}
