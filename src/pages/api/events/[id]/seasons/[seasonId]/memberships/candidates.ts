import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { getSeasonForEvent, requireSeasonAdmin, seasonAttendanceWindow } from "~/lib/seasonSetup.server";

/**
 * List enrollment candidates for a Season (admin-only): every EventPlayer of
 * the event annotated with account presence, recent attendance and current
 * membership state. Powers the "add player" autocomplete in the setup UI.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const season = await getSeasonForEvent(params.seasonId ?? "", params.id ?? "");
  if (!season) return Response.json({ error: "Season not found." }, { status: 404 });
  const authz = await requireSeasonAdmin(season, session, request);
  if (!authz.allowed) return Response.json({ error: "Event access required." }, { status: 403 });
  if (!authz.isAdmin) return Response.json({ error: "Only the event owner or an admin can manage a Season." }, { status: 403 });

  const attendanceWindow = seasonAttendanceWindow(season);
  const [eventPlayers, memberships, participants, users] = await Promise.all([
    prisma.eventPlayer.findMany({
      where: { eventId: season.eventId },
      select: { id: true, name: true, userId: true },
      orderBy: { name: "asc" },
    }),
    prisma.seasonMembership.findMany({
      where: { seasonId: season.id },
      select: { eventPlayerId: true, userId: true, status: true },
    }),
    prisma.gameParticipant.findMany({
      where: {
        eventPlayer: { eventId: season.eventId },
        status: "active",
        game: {
          eventId: season.eventId,
          status: { not: "cancelled" },
          dateTime: { gte: attendanceWindow.gte, lte: attendanceWindow.lte },
        },
      },
      select: { eventPlayerId: true },
    }),
    prisma.user.findMany({ select: { id: true } }),
  ]);

  const membershipByEventPlayerId = new Map(memberships.map((membership) => [membership.eventPlayerId, membership.status]));
  const userIds = new Set(users.map((user) => user.id));
  const gamesPlayedByEventPlayer = new Map<string, number>();
  for (const participant of participants) {
    gamesPlayedByEventPlayer.set(participant.eventPlayerId, (gamesPlayedByEventPlayer.get(participant.eventPlayerId) ?? 0) + 1);
  }

  return Response.json({
    players: eventPlayers.map((player) => ({
      eventPlayerId: player.id,
      name: player.name,
      hasAccount: !!player.userId && userIds.has(player.userId),
      gamesPlayed: gamesPlayedByEventPlayer.get(player.id) ?? 0,
      memberStatus: membershipByEventPlayerId.get(player.id) ?? null,
    })),
  });
};
