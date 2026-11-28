import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useLocale } from "~/lib/useT";
import { rosterChanges, shortNames } from "~/lib/nextGame";
import type { Player } from "../types";

/** Changes that arrive close together are told in one sentence, at most this often. */
export const ANNOUNCE_BATCH_MS = 2500;
/** How long the sentence stays in the live region before it is cleared. */
const CLEAR_AFTER_MS = 6000;

/**
 * The sentence for a screen reader when OTHER people join or leave while the viewer has the page open
 * ("Ana M. joined"), found by the page's own polling. The viewer's own actions are not announced — they
 * have their own feedback — and neither is the first reading. Several changes within a batch become one sentence.
 *
 * `quiet()` says whether the viewer is in the middle of (or just finished) a change of their own: the list then
 * moves because of them, so what changed is taken as the new starting point without a word.
 */
export function useRosterAnnouncements(players: readonly Player[], viewerId: string | null, quiet: () => boolean): string {
  const { t, locale } = useLocale();
  const [message, setMessage] = useState("");
  const last = useRef<readonly Player[]>(players);
  const pending = useRef<{ joined: string[]; left: string[] }>({ joined: [], left: [] });
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Reads the viewer's language when the timer fires, not when it was set.
  const speak = useEffectEvent((joined: string[], left: string[]): string => {
    const list = new Intl.ListFormat(locale, { type: "conjunction" });
    const part = (names: string[], one: "ngJoined" | "ngLeft", many: "ngJoinedMany" | "ngLeftMany", count: "ngJoinedCount" | "ngLeftCount") => {
      if (names.length === 0) return "";
      if (names.length > 3) return t(count, { n: names.length });
      return t(names.length === 1 ? one : many, { names: list.format(shortNames(names)) });
    };
    return [part(joined, "ngJoined", "ngJoinedMany", "ngJoinedCount"), part(left, "ngLeft", "ngLeftMany", "ngLeftCount")].filter(Boolean).join(". ");
  });

  useEffect(() => {
    const before = last.current;
    last.current = players;
    if (before === players) return;
    if (quiet()) return;
    const { joined, left } = rosterChanges(before, players, viewerId);
    if (joined.length === 0 && left.length === 0) return;
    pending.current.joined.push(...joined);
    pending.current.left.push(...left);
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = undefined;
      const { joined: j, left: l } = pending.current;
      pending.current = { joined: [], left: [] };
      // Someone who joined and left inside one batch is not news.
      const net = rosterChanges(j.map((name) => ({ name })), l.map((name) => ({ name })), null);
      const stillJoined = net.left; // in the "joined" list and not in the "left" one
      const stillLeft = net.joined;
      setMessage(speak(stillJoined, stillLeft));
      clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setMessage(""), CLEAR_AFTER_MS);
    }, ANNOUNCE_BATCH_MS);
  }, [players, viewerId, quiet]);

  useEffect(() => () => { clearTimeout(flushTimer.current); clearTimeout(clearTimer.current); }, []);

  return message;
}
