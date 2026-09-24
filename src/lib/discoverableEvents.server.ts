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

export type DiscoverableEventRow = Prisma.EventGetPayload<{
  include: { players: true };
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
    playerCount: e.players.length,
    spotsLeft: Math.max(0, e.maxPlayers - e.players.length),
    isRecurring: e.isRecurring,
    source: e.source,
    ownerId: e.ownerId,
    playtomicTenantName: e.playtomicTenantName,
  };
}

/**
 * Fetch the soonest upcoming Discoverable Events, soonest-first, optionally
 * excluding a set of Event ids and capped at `take`.
 */
export async function findDiscoverableUpcomingEvents(opts: {
  take?: number;
  excludeEventIds?: string[];
  now?: Date;
} = {}): Promise<DiscoverableEventSummary[]> {
  const { take = 3, excludeEventIds = [], now = new Date() } = opts;
  const events = await prisma.event.findMany({
    where: discoverableUpcomingWhere(now, excludeEventIds),
    include: { players: { orderBy: { order: "asc" } } },
    orderBy: { dateTime: "asc" },
    take,
  });
  return events.map(mapDiscoverableEvent);
}
