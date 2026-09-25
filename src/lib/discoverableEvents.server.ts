/**
 * Shared accessor for *Discoverable Events that are still joinable*.
 *
 * A Discoverable Event (isPublic = true, see CONTEXT.md) only belongs in a
 * "games to join" surface while it is upcoming — a past kickoff is not
 * joinable. Both the public listing (`GET /api/events/public`) and the signed-in
 * Home discover strip (`GET /api/me/home`) must agree on that filter, so it
 * lives here instead of being re-derived per route.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db.server";

/**
 * A discovery-listed Event with its non-archived Player count.
 *
 * Roster counts must exclude archived rows: legacy Player rows accumulate across
 * recurring occurrences and `getActiveRosterState` (the authoritative accessor,
 * ADR 0016) filters `archivedAt: null`. Counting all `players` inflates
 * `playerCount` and under-reports `spotsLeft`.
 */
export type DiscoverableEventRow = Prisma.EventGetPayload<{
  include: { _count: { select: { players: true } } };
}>;

export interface DiscoverableEventSummary {
  id: string;
  url: string;
  title: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  sport: string;
  dateTime: string;
  timezone: string;
  maxPlayers: number;
  playerCount: number;
  spotsLeft: number;
  isRecurring: boolean;
  source: string;
  ownerId: string | null;
  playtomicTenantName: string | null;
}

/**
 * Prisma where-clause for Events that are public, not archived and whose next
 * occurrence (Event.dateTime) is at or after `now`. Callers layer their own
 * exclusions (e.g. "not already involved") and pagination on top.
 */
export function discoverableUpcomingWhere(
  now: Date = new Date(),
  excludeEventIds: string[] = [],
): Prisma.EventWhereInput {
  return {
    isPublic: true,
    archivedAt: null,
    dateTime: { gte: now },
    ...(excludeEventIds.length > 0 ? { id: { notIn: excludeEventIds } } : {}),
  };
}

/** Serialise an Event row (with `players` included) for a discover surface. */
export function mapDiscoverableEvent(e: DiscoverableEventRow): DiscoverableEventSummary {
  return {
    id: e.id,
    url: `/events/${e.id}`,
    title: e.title,
    location: e.location,
    latitude: e.latitude,
    longitude: e.longitude,
    sport: e.sport,
    dateTime: e.dateTime.toISOString(),
    timezone: e.timezone,
    maxPlayers: e.maxPlayers,
    playerCount: e._count.players,
    spotsLeft: Math.max(0, e.maxPlayers - e._count.players),
    isRecurring: e.isRecurring,
    source: e.source,
    ownerId: e.ownerId,
    playtomicTenantName: e.playtomicTenantName,
  };
}

/**
 * Fetch upcoming Discoverable Events, optionally excluding a set of Event ids
 * and capped at `take`.
 *
 * Ordering is *time-first* by default (soonest kickoff). When the caller knows
 * the user's `origin` (inferred home region) and/or `preferredSports`, the
 * result is re-ranked so the strip feels local and relevant:
 *   - distance to `origin` ascending, with a bonus that makes a preferred-sport
 *     Event rank as if it were `SPORT_MATCH_BONUS_KM` closer;
 *   - without an origin, preferred-sport Events first, then soonest.
 *
 * The pool is capped before ranking (there is no geo index in SQLite); a user
 * with more than `RANK_POOL` future public Events may not see the absolute
 * nearest, which is fine for a 3-item glimpse.
 */
const RANK_POOL = 100;
const SPORT_MATCH_BONUS_KM = 25;

/** Great-circle distance between two coordinates, in kilometres. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function rankDiscover(
  events: DiscoverableEventSummary[],
  origin: { lat: number; lng: number } | undefined,
  preferredSports: string[],
): DiscoverableEventSummary[] {
  const sports = new Set(preferredSports);
  const kickoff = (e: DiscoverableEventSummary) => new Date(e.dateTime).getTime();

  const scored = events.map((e) => {
    const distanceKm =
      origin && e.latitude !== null && e.longitude !== null
        ? haversineKm(origin, { lat: e.latitude, lng: e.longitude })
        : null;
    const matchesSport = sports.size === 0 || sports.has(e.sport);
    return { e, distanceKm, matchesSport };
  });

  scored.sort((a, b) => {
    if (origin) {
      const scoreA = (a.distanceKm ?? Infinity) - (a.matchesSport ? SPORT_MATCH_BONUS_KM : 0);
      const scoreB = (b.distanceKm ?? Infinity) - (b.matchesSport ? SPORT_MATCH_BONUS_KM : 0);
      if (scoreA !== scoreB) return scoreA - scoreB;
    } else if (a.matchesSport !== b.matchesSport) {
      return a.matchesSport ? -1 : 1;
    }
    return kickoff(a.e) - kickoff(b.e);
  });

  return scored.map((s) => s.e);
}

export async function findDiscoverableUpcomingEvents(opts: {
  take?: number;
  excludeEventIds?: string[];
  now?: Date;
  origin?: { lat: number; lng: number };
  preferredSports?: string[];
} = {}): Promise<DiscoverableEventSummary[]> {
  const { take = 3, excludeEventIds = [], now = new Date(), origin, preferredSports = [] } = opts;
  // Discover only shows Events the user can still join (ADR 0041): a full Event
  // has no spots remaining. "Fewer active players than maxPlayers" cannot be
  // expressed as a relation filter, so the joinable check runs here on the
  // accurate non-archived count. The public listing (`/api/events/public`)
  // deliberately keeps full Events visible, so this rule does not live in
  // `discoverableUpcomingWhere`.
  const events = await prisma.event.findMany({
    where: discoverableUpcomingWhere(now, excludeEventIds),
    include: { _count: { select: { players: { where: { archivedAt: null } } } } },
    orderBy: { dateTime: "asc" },
    take: Math.max(take, RANK_POOL),
  });
  const joinable = events
    .filter((e) => e.maxPlayers - e._count.players > 0)
    .map(mapDiscoverableEvent);
  return rankDiscover(joinable, origin, preferredSports).slice(0, take);
}
