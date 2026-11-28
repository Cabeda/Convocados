import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "~/lib/api/client";
import { useT } from "~/lib/useT";
import { getQjName } from "~/lib/knownNames";
import { mergeSuggestionPills, type SuggestionPill } from "~/lib/suggestionPills";
import type { KnownPlayer } from "../types";

interface CoPlayer { name: string; userId: string; image: string | null; coPlayCount: number }
interface Ranked { userId: string; name: string; image?: string | null; reason?: string }

/**
 * "Played with you before": this event's regulars, the people the viewer has played with anywhere, and
 * (for the organizer) the ranked co-play suggestions. Read only once the panel is first opened.
 * Names already on the list or already invited are left out.
 */
export function useFriendSuggestions(o: { eventId: string; enabled: boolean; signedIn: boolean; organizer: boolean; hasGame: boolean; takenNames: readonly string[] }) {
  const t = useT();
  const { eventId, enabled, signedIn, organizer, hasGame } = o;
  const [known, setKnown] = useState<KnownPlayer[]>([]);
  const [coPlayers, setCoPlayers] = useState<CoPlayer[]>([]);
  const [ranked, setRanked] = useState<Ranked[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    const init = { signal: c.signal };
    apiRequest("GET /api/events/{id}/known-players", { params: { id: eventId }, init }).then((d) => setKnown((d as { players: KnownPlayer[] }).players ?? [])).catch(() => {});
    if (signedIn) apiRequest("GET /api/me/co-players", { init }).then((d) => setCoPlayers((d as { players: CoPlayer[] }).players ?? [])).catch(() => {});
    if (organizer && hasGame) apiRequest("GET /api/events/{id}/suggestions", { params: { id: eventId }, init }).then((d) => setRanked(((d as { suggestions?: Ranked[] }).suggestions) ?? [])).catch(() => {});
    return () => c.abort();
  }, [enabled, eventId, signedIn, organizer, hasGame]);

  const takenKey = o.takenNames.join("\u0000");
  return useMemo<SuggestionPill[]>(() => {
    // This event's history first, then global co-players; the event's count wins when both know the person.
    const byName = new Map<string, { name: string; userId: string | null; image: string | null; score: number; reason: string }>();
    // Why each person is suggested, in words: the games they played here, else how often they played with the viewer.
    for (const p of known) {
      const games = p.gamesPlayed ?? 1;
      byName.set(p.name.toLowerCase(), { name: p.name, userId: p.userId ?? null, image: p.image ?? null, score: games, reason: t(games === 1 ? "ngGamesHereOne" : "ngGamesHere", { n: games }) });
    }
    for (const cp of coPlayers) {
      const key = cp.name.toLowerCase();
      const existing = byName.get(key);
      if (existing) existing.score += cp.coPlayCount;
      else byName.set(key, { name: cp.name, userId: cp.userId, image: cp.image ?? null, score: cp.coPlayCount, reason: t("ngPlayedWithYou", { n: cp.coPlayCount }) });
    }
    const me = getQjName().trim().toLowerCase();
    const fallback = [...byName.values()]
      .sort((a, b) => (b.name.toLowerCase() === me ? 1 : 0) - (a.name.toLowerCase() === me ? 1 : 0) || b.score - a.score)
      .map(({ name, userId, image, reason }) => ({ name, userId, image, reason }));
    const reasonOf = new Map(fallback.map((f) => [f.name.toLowerCase(), f.reason]));
    const rankedPills = ranked.map((r) => ({ name: r.name, userId: r.userId, image: r.image, reason: r.reason ?? reasonOf.get(r.name.toLowerCase()) }));
    return mergeSuggestionPills(rankedPills, fallback, { currentNames: takenKey ? takenKey.split("\u0000") : [] }).pills;
  }, [known, coPlayers, ranked, takenKey, t]);
}
