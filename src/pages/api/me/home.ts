import type { APIRoute } from "astro";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/db.server";
import { getSession } from "../../../lib/auth.helpers.server";
import { authenticateRequest } from "../../../lib/authenticate.server";
import { getActiveRosterState } from "../../../lib/roster.server";
import { findDiscoverableUpcomingEvents } from "../../../lib/discoverableEvents.server";
import { computeHomeActions } from "../../../lib/homeActions.server";

/** Signed-in Home: the soonest few games the user plays/organizes, plus a
 *  glimpse of Discoverable Events they could join. See ADR 0041. */
const UP_NEXT_LIMIT = 3;
const DISCOVER_LIMIT = 3;

const upNextSelect = {
  id: true,
  title: true,
  location: true,
  dateTime: true,
  timezone: true,
  sport: true,
  maxPlayers: true,
  isRecurring: true,
  currentGameId: true,
} as const;

type UpNextRow = Prisma.EventGetPayload<{ select: typeof upNextSelect }>;

interface UpNextEvent {
  id: string;
  title: string;
  location: string;
  dateTime: string;
  timezone: string;
  sport: string;
  maxPlayers: number;
  playerCount: number;
  isRecurring: boolean;
  status: string;
}

export const GET: APIRoute = async ({ request }) => {
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Every Event the user is involved in — plays (roster), organizes (owner), or
  // administers. Used both to build Up next and to exclude Discover.
  const involvedWhere: Prisma.EventWhereInput = {
    archivedAt: null,
    OR: [
      { ownerId: userId },
      { admins: { some: { userId } } },
      { eventPlayers: { some: { userId } } },
    ],
  };

  const [involved, liveEvents, upcomingEvents] = await Promise.all([
    prisma.event.findMany({
      where: involvedWhere,
      select: { id: true, latitude: true, longitude: true, sport: true },
    }),
    // In-progress games have a kickoff in the past, so they need their own query
    // (the upcoming query filters dateTime >= now).
    prisma.event.findMany({
      where: { ...involvedWhere, games: { some: { status: "in_progress" } } },
      select: upNextSelect,
      orderBy: { dateTime: "asc" },
      take: UP_NEXT_LIMIT,
    }),
    prisma.event.findMany({
      where: { ...involvedWhere, dateTime: { gte: now } },
      select: upNextSelect,
      orderBy: { dateTime: "asc" },
      take: UP_NEXT_LIMIT + 1,
    }),
  ]);

  const liveIds = new Set(liveEvents.map((e) => e.id));
  const merged: Array<{ row: UpNextRow; status: string }> = [
    ...liveEvents.map((row) => ({ row, status: "in_progress" })),
    ...upcomingEvents
      .filter((e) => !liveIds.has(e.id))
      .map((row) => ({ row, status: "upcoming" })),
  ].slice(0, UP_NEXT_LIMIT);

  const upNext: UpNextEvent[] = await Promise.all(
    merged.map(async ({ row, status }) => ({
      id: row.id,
      title: row.title,
      location: row.location,
      dateTime: row.dateTime.toISOString(),
      timezone: row.timezone,
      sport: row.sport,
      maxPlayers: row.maxPlayers,
      playerCount: (await getActiveRosterState(row.id, row.maxPlayers, row.currentGameId)).totalCount,
      isRecurring: row.isRecurring,
      status,
    })),
  );

  // Inferred home region + preferred sports, so Discover feels local and
  // relevant without ever asking the user (ADR 0041). Located games give a
  // centroid; all involved games give the sport set. Both degrade gracefully:
  // no located games → ranking falls back to soonest-first.
  const located = involved.filter((e) => e.latitude !== null && e.longitude !== null);
  const origin = located.length > 0
    ? {
        lat: located.reduce((sum, e) => sum + (e.latitude as number), 0) / located.length,
        lng: located.reduce((sum, e) => sum + (e.longitude as number), 0) / located.length,
      }
    : undefined;
  const preferredSports = [...new Set(involved.map((e) => e.sport))];

  const discover = await findDiscoverableUpcomingEvents({
    take: DISCOVER_LIMIT,
    excludeEventIds: involved.map((e) => e.id),
    now,
    origin,
    preferredSports,
  });

  // "Needs you" — the viewer's own actionable items (fill spots, settle,
  // pay, vote). Batch, capped, self-clearing. See homeActions.server.ts.
  const actions = await computeHomeActions(userId, now);

  // Growth prompt (#1166): the viewer plays in an Event they don't own (proof
  // of other groups), or owns no active events at all. Cheap checks.
  const [playedElsewhere, ownedActive] = await Promise.all([
    prisma.event.count({
      where: {
        archivedAt: null,
        ownerId: { not: userId },
        eventPlayers: { some: { userId } },
      },
    }),
    prisma.event.count({ where: { archivedAt: null, ownerId: userId } }),
  ]);
  const suggestAddGames = playedElsewhere > 0 || ownedActive === 0;

  return Response.json({ upNext, discover, actions, suggestAddGames });
};
