import { useCallback, useState } from "react";

const keyOf = (eventId: string) => `whos-in:${eventId}`;

const read = (eventId: string): boolean | null => {
  try {
    const v = localStorage.getItem(keyOf(eventId));
    return v === "open" ? true : v === "closed" ? false : null;
  } catch { return null; }
};

/**
 * Is "Who's in" open? What the viewer chose last time on this event wins; until they choose, it is open
 * only when there is a reason to see names (an organizer, a bench, or two people's letters to tell apart).
 */
export function useWhosInOpen(eventId: string, defaultOpen: boolean): [boolean, (open: boolean) => void] {
  const [chosen, setChosen] = useState<boolean | null>(() => read(eventId));
  const set = useCallback((open: boolean) => {
    setChosen(open);
    try { localStorage.setItem(keyOf(eventId), open ? "open" : "closed"); } catch { /* private mode: it just will not be remembered */ }
  }, [eventId]);
  return [chosen ?? defaultOpen, set];
}
