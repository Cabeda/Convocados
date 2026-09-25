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
/** Invitations + direct-add acknowledgements shown on Home. */
const INBOX_LIMIT = 5;
/** A direct add is "worth noticing" for this long before it stops appearing. */
const ROSTER_ADD_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

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

  const [involved, followed, liveEvents, upcomingEvents] = await Promise.all([
    prisma.event.findMany({
      where: involvedWhere,
      select: { id: true, latitude: true, longitude: true, sport: true },
    }),
    // Followed-only Events are not Up next, but Discover must skip them too:
    // the user is already engaged, so they are not "games to join" (ADR 0041).
    prisma.eventFollow.findMany({ where: { userId }, select: { eventId: true } }),
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
    excludeEventIds: [
      ...new Set([...involved.map((e) => e.id), ...followed.map((f) => f.eventId)]),
    ],
    now,
    origin,
    preferredSports,
  });

  // "Needs you" — the viewer's own actionable items (fill spots, settle,
  // pay, vote). Batch, capped, self-clearing. See homeActions.server.ts.
  const actions = await computeHomeActions(userId, now);

  // Invitations inbox: pending PlayerInvites pointed at the viewer, so a
  // "come play" never depends on finding the original push notification.
  const pendingInvites = await prisma.playerInvite.findMany({
    where: {
      status: "pending",
      eventPlayer: { userId },
      game: { dateTime: { gt: now } },
    },
    select: {
      id: true,
      token: true,
      gameId: true,
      invitedBy: { select: { name: true } },
      eventPlayer: {
        select: {
          event: {
            select: { id: true, title: true, location: true, dateTime: true, sport: true, ownerId: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: INBOX_LIMIT,
  });

  const invitations = pendingInvites.map((inv) => ({
    id: inv.id,
    token: inv.token,
    eventId: inv.eventPlayer.event.id,
    eventTitle: inv.eventPlayer.event.title,
    location: inv.eventPlayer.event.location,
    dateTime: inv.eventPlayer.event.dateTime.toISOString(),
    sport: inv.eventPlayer.event.sport,
    invitedByName: inv.invitedBy.name,
  }));

  // Direct adds: a manager put the viewer straight onto the roster (no invite,
  // nothing to accept). Recent, not-own, not-pending entries surface as an
  // acknowledgement the viewer can dismiss.
  const recentAdds = await prisma.gameParticipant.findMany({
    where: {
      status: "active",
      createdAt: { gt: new Date(now.getTime() - ROSTER_ADD_WINDOW_MS) },
      eventPlayer: {
        userId,
        event: { ownerId: { not: userId }, archivedAt: null },
      },
      game: { dateTime: { gt: now } },
    },
    select: {
      id: true,
      gameId: true,
      createdAt: true,
      eventPlayer: {
        select: {
          event: { select: { id: true, title: true, location: true, dateTime: true, sport: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: INBOX_LIMIT,
  });

  const rosterAdds = recentAdds.map((p) => ({
    id: p.id,
    eventId: p.eventPlayer.event.id,
    eventTitle: p.eventPlayer.event.title,
    location: p.eventPlayer.event.location,
    dateTime: p.eventPlayer.event.dateTime.toISOString(),
    sport: p.eventPlayer.event.sport,
  }));

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

  return Response.json({ upNext, discover, actions, suggestAddGames, invitations, rosterAdds });
};
