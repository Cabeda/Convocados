/**
 * Canonical lifetime Skill Rating accessor.
 *
 * Today the live Elo engine writes the legacy `PlayerRating` store. This is the
 * ONLY place Season Rank reads a rating store, so the GH-522 migration
 * (`PlayerRating` -> `EventPlayer.rating`) changes one file (ADR 0031).
 */
import { prisma } from "./db.server";

export interface LifetimeSkill {
  rating: number;
  gamesPlayed: number;
}

export const DEFAULT_SKILL = 1000;

/** Skill Rating per player name for an Event; unknown players default to 1000. */
export async function getLifetimeSkill(
  eventId: string,
  names: string[],
): Promise<Map<string, LifetimeSkill>> {
  const unique = [...new Set(names)];
  const rows = unique.length
    ? await prisma.playerRating.findMany({
        where: { eventId, name: { in: unique } },
        select: { name: true, rating: true, gamesPlayed: true },
      })
    : [];
  const map = new Map(rows.map((r) => [r.name, { rating: r.rating, gamesPlayed: r.gamesPlayed }]));
  for (const name of unique) {
    if (!map.has(name)) map.set(name, { rating: DEFAULT_SKILL, gamesPlayed: 0 });
  }
  return map;
}
