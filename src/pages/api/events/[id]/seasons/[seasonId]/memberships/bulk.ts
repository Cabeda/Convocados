import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { getSeasonForEvent, requireSeasonAdmin } from "~/lib/seasonSetup.server";

/**
 * Bulk-enroll recent players into a Season (admin-only).
 *
 * Organizers should not have to wait for every player to join manually:
 * one call enrolls every EventPlayer with game participation inside the
 * Season's registration period. Players without an account are reported as
 * skipped (memberships require a user); withdrawn members are reactivated.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;
  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const season = await getSeasonForEvent(params.seasonId ?? "", params.id ?? "");
  if (!season) return Response.json({ error: "Season not found." }, { status: 404 });
  const authz = await requireSeasonAdmin(season, session, request);
  if (!authz.allowed) return Response.json({ error: "Event access required." }, { status: 403 });
  if (!authz.isAdmin) return Response.json({ error: "Only the event owner or an admin can manage a Season." }, { status: 403 });
  // Admins may bulk-enroll at any point in the lifecycle, including after
  // registration closed — same override as the single join path.

  const participants = await prisma.gameParticipant.findMany({
    where: {
      eventPlayer: { eventId: season.eventId },
      status: "active",
      game: {
        eventId: season.eventId,
        status: { not: "cancelled" },
        dateTime: { gte: season.registrationOpensAt, lte: season.registrationClosesAt },
      },
    },
    select: { eventPlayerId: true },
  });
  const candidateIds = [...new Set(participants.map((participant) => participant.eventPlayerId))];
  if (candidateIds.length === 0) return Response.json({ added: [], skipped: [] });

  const [eventPlayers, memberships] = await Promise.all([
    prisma.eventPlayer.findMany({
      where: { id: { in: candidateIds }, eventId: season.eventId },
      select: { id: true, name: true, userId: true },
    }),
    prisma.seasonMembership.findMany({
      where: { seasonId: season.id, eventPlayerId: { in: candidateIds } },
      select: { id: true, eventPlayerId: true, userId: true, status: true },
    }),
  ]);
  const candidateUserIds = [...new Set(eventPlayers.flatMap((player) => (player.userId ? [player.userId] : [])))];
  const users = await prisma.user.findMany({ where: { id: { in: candidateUserIds } }, select: { id: true } });
  const membershipByEventPlayerId = new Map(memberships.map((membership) => [membership.eventPlayerId, membership]));
  const membershipByUserId = new Map(memberships.map((membership) => [membership.userId, membership]));
  const userIds = new Set(users.map((user) => user.id));

  const added: Array<{ membershipId: string; eventPlayerId: string; name: string }> = [];
  const skipped: Array<{ eventPlayerId: string; name: string; reason: string }> = [];

  for (const player of eventPlayers.sort((a, b) => a.name.localeCompare(b.name))) {
    const existing = membershipByEventPlayerId.get(player.id) ?? (player.userId ? membershipByUserId.get(player.userId) : undefined);
    if (existing?.status === "active") {
      skipped.push({ eventPlayerId: player.id, name: player.name, reason: "alreadyMember" });
      continue;
    }
    if (!player.userId || !userIds.has(player.userId)) {
      skipped.push({ eventPlayerId: player.id, name: player.name, reason: "noAccount" });
      continue;
    }
    if (existing) {
      const reactivated = await prisma.seasonMembership.update({
        where: { id: existing.id },
        data: { status: "active", withdrawnAt: null },
      });
      added.push({ membershipId: reactivated.id, eventPlayerId: player.id, name: player.name });
      continue;
    }
    const created = await prisma.seasonMembership.create({
      data: { seasonId: season.id, eventPlayerId: player.id, userId: player.userId },
    });
    added.push({ membershipId: created.id, eventPlayerId: player.id, name: player.name });
  }

  return Response.json({ added, skipped });
};
