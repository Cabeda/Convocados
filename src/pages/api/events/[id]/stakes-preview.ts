import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession, checkEventAdmin, checkOwnership } from "~/lib/auth.helpers.server";
import { checkAccess } from "~/lib/eventAccess";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { getStakesPreview, activeSeasonWhere } from "~/lib/stakesPreview.server";

/**
 * Stakes Preview for the Event's active Season (ADR 0050).
 *
 * Participant-only, and only for the next unscored, non-friendly Game.
 * Competitive data hidden from players (`showCompetitiveData = false`) hides
 * the preview from everyone but the owner/admin. Per-player Rank movement is
 * private: the response carries the viewer's own only. Scenarios are computed
 * server-side so raw Skill Rating never leaves the server.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "read");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      ownerId: true,
      accessPassword: true,
      dateTime: true,
      currentGameId: true,
      showCompetitiveData: true,
    },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // ── Access control (mirrors GET /api/events/[id]/status) ──────────────────
  if (event.accessPassword) {
    const session = await getSession(request);
    const isInvited = session?.user
      ? (await prisma.eventInvite.count({ where: { eventId, userId: session.user.id } })) > 0
      : false;
    const isEventAdmin = session?.user ? await checkEventAdmin(eventId, session.user.id) : false;
    const access = checkAccess({
      eventOwnerId: event.ownerId,
      accessPassword: event.accessPassword,
      requestUserId: session?.user?.id ?? null,
      cookieHeader: request.headers.get("cookie"),
      eventId,
      isInvited: isInvited || isEventAdmin,
    });
    if (!access.granted) return Response.json({ error: "Event access required." }, { status: 403 });
  }

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const season = await prisma.season.findFirst({
    where: activeSeasonWhere(eventId, event.dateTime),
    orderBy: { registrationOpensAt: "desc" },
    select: { id: true },
  });
  if (!season) return Response.json({ active: false });

  const membership = await prisma.seasonMembership.findUnique({
    where: { seasonId_userId: { seasonId: season.id, userId: session.user.id } },
    select: { status: true, eventPlayer: { select: { name: true } } },
  });
  if (!membership || membership.status === "withdrawn") {
    return Response.json({ error: "Only Season participants can view the Stakes Preview." }, { status: 403 });
  }

  // Competitive data hidden from players hides the preview too (owner/admin keep it).
  if (!event.showCompetitiveData) {
    const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, eventId);
    if (!isOwner && !isAdmin) return Response.json({ active: false });
  }

  // Only the next unscored, non-friendly Game: once the score is in, or the Game
  // is Friendly/cancelled, there is nothing left to project.
  const game = event.currentGameId
    ? await prisma.game.findUnique({
        where: { id: event.currentGameId },
        select: { status: true, isFriendly: true, scoreOne: true, scoreTwo: true },
      })
    : null;
  if (
    !game ||
    game.isFriendly ||
    game.status === "played" ||
    game.status === "cancelled" ||
    game.scoreOne !== null ||
    game.scoreTwo !== null
  ) {
    return Response.json({ active: false });
  }

  let body: { teamOne?: unknown; teamTwo?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const teamOne = asNameList(body.teamOne);
  const teamTwo = asNameList(body.teamTwo);
  if (!teamOne || !teamTwo) {
    return Response.json({ error: "teamOne and teamTwo lineups are required." }, { status: 400 });
  }

  const preview = await getStakesPreview(eventId, event.dateTime, { teamOne, teamTwo }, membership.eventPlayer.name);
  if (!preview) return Response.json({ active: false });

  return Response.json({ active: true, preview });
};

function asNameList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const names = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (names.length !== value.length) return null;
  return names.map((name) => name.trim());
}
