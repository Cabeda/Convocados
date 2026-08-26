import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession, checkEventAdmin } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { isGameEnded } from "~/lib/gameStatus";
import { getActiveRosterState } from "~/lib/roster.server";
import { createPlayerInvite, createGuestPlayerInvite } from "~/lib/invite.server";
import { getNotificationPrefs, wantsInvites } from "~/lib/notificationPrefs.server";
import { resolveRosterTarget, upsertEventPlayerForRoster, upsertGameParticipantForRoster } from "~/lib/rosterCore.server";
import { syncGamePayments } from "~/lib/settlement.server";
import { addPlayerToTeams, validateTeams } from "./players";

/**
 * POST /api/events/[id]/roster — unified roster mutation (ADR 0025, #814).
 *
 * Body: { name?: string, email?: string, userId?: string, asInvite?: boolean, deliver?: boolean }
 * - asInvite false/omitted → direct add (active GameParticipant)
 * - asInvite true           → pending PlayerInvite (invite flow)
 * - deliver false           → link-only invite (no notification, same as PR #833 share-a-link)
 *
 * Existing routes /players and /invites remain as thin deprecated aliases for backward
 * compat (Android ≤3.15, web). New clients should use this single endpoint.
 */
async function canInviteOnEvent(eventId: string, userId: string): Promise<boolean> {
  const [isAdmin, event] = await Promise.all([
    checkEventAdmin(eventId, userId),
    prisma.event.findUnique({ where: { id: eventId }, select: { ownerId: true } }),
  ]);
  if (isAdmin) return true;
  if (event?.ownerId === userId) return true;
  const played = await prisma.eventPlayer.findFirst({
    where: { eventId, userId, participations: { some: {} } },
    select: { id: true },
  });
  return !!played;
}

async function inviteBlockReason(eventId: string, gameId: string, inviteeUserId: string): Promise<string | null> {
  const [prefs, ep, participant, pending, rsvpNo, noShow] = await Promise.all([
    getNotificationPrefs(inviteeUserId),
    prisma.eventPlayer.findFirst({ where: { eventId, userId: inviteeUserId } }),
    prisma.gameParticipant.findFirst({
      where: { gameId, eventPlayer: { userId: inviteeUserId }, archivedAt: null, status: { not: "pending" } },
      select: { id: true },
    }),
    prisma.playerInvite.findFirst({
      where: { gameId, eventPlayer: { userId: inviteeUserId }, status: "pending" },
      select: { id: true },
    }),
    prisma.rsvp.findFirst({
      where: { gameId, eventPlayer: { userId: inviteeUserId }, status: "no" },
      select: { id: true },
    }),
    prisma.priorityEnrollment.findFirst({
      where: { eventId, userId: inviteeUserId },
      select: { noShowStreak: true },
    }),
  ]);
  if (!wantsInvites(prefs)) return "This user has turned off game invites.";
  if (ep?.invitationOptOutAt) return "This user opted out of invites for this event.";
  if (participant) return "This user is already on the player list.";
  if (pending) return "This user already has a pending invite.";
  if (rsvpNo) return "This user declined this game.";
  if ((noShow?.noShowStreak ?? 0) >= 2) return "This user has missed the last two games.";
  return null;
}

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const session = await getSession(request);
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, ownerId: true, currentGameId: true, dateTime: true, durationMinutes: true, maxPlayers: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });
  if (!event.currentGameId) return Response.json({ error: "This event has no current game." }, { status: 400 });
  if (isGameEnded(event.dateTime, event.durationMinutes)) {
    return Response.json({ error: "The game has already ended — players can no longer be added." }, { status: 403 });
  }

  let body: { name?: unknown; email?: unknown; userId?: unknown; asInvite?: unknown; deliver?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const asInvite = body.asInvite === true;
  const deliver = body.deliver === false ? false : true;

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.cabeda.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  // Guest invite via roster (asInvite + name only, no userId/email)
  if (asInvite && typeof body.name === "string" && body.name.trim() && typeof body.userId !== "string" && typeof body.email !== "string") {
    if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });
    if (!(await canInviteOnEvent(eventId, session.user.id))) {
      return Response.json({ error: "Only the owner, an admin, or a player of this event can send invites." }, { status: 403 });
    }
    const guestName = (body.name as string).trim().slice(0, 50);
    const ep = await upsertEventPlayerForRoster(eventId, { name: guestName, userId: null, user: null });
    const [activeParticipant, pendingInvite, rsvpNo] = await Promise.all([
      prisma.gameParticipant.findFirst({
        where: { gameId: event.currentGameId, eventPlayerId: ep.id, archivedAt: null, status: { not: "pending" } },
        select: { id: true },
      }),
      prisma.playerInvite.findFirst({ where: { gameId: event.currentGameId, eventPlayerId: ep.id, status: "pending" }, select: { id: true } }),
      prisma.rsvp.findFirst({ where: { gameId: event.currentGameId, eventPlayerId: ep.id, status: "no" }, select: { id: true } }),
    ]);
    if (activeParticipant) return Response.json({ error: "This player is already on the player list." }, { status: 409 });
    if (rsvpNo) return Response.json({ error: "This player declined this game." }, { status: 409 });
    if (pendingInvite) {
      const existing = await prisma.playerInvite.findFirstOrThrow({
        where: { gameId: event.currentGameId, eventPlayerId: ep.id, status: "pending" },
      });
      return Response.json({ ok: true, inviteId: existing.id, token: existing.token, inviteUrl: `${origin}/invite/${existing.token}`, channels: { email: false, webPush: false, appPush: false } });
    }
    const result = await createGuestPlayerInvite({
      eventId,
      gameId: event.currentGameId,
      eventPlayerId: ep.id,
      invitedByUserId: session.user.id,
      origin,
    });
    return Response.json({ ok: true, ...result });
  }

  // Authenticated invite (asInvite true, userId or email)
  if (asInvite) {
    if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });
    if (!(await canInviteOnEvent(eventId, session.user.id))) {
      return Response.json({ error: "Only the owner, an admin, or a player of this event can send invites." }, { status: 403 });
    }
    if (event.dateTime <= new Date()) return Response.json({ error: "This game has already started." }, { status: 400 });

    let inviteeUserId: string;
    if (typeof body.userId === "string" && (body.userId as string).trim()) {
      inviteeUserId = (body.userId as string).trim();
    } else if (typeof body.email === "string" && (body.email as string).trim()) {
      const normalized = (body.email as string).trim().toLowerCase();
      const user = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
      if (!user) return Response.json({ error: "No registered user with that email." }, { status: 404 });
      inviteeUserId = user.id;
    } else {
      return Response.json({ error: "userId, email or name is required for invite." }, { status: 400 });
    }

    const reason = await inviteBlockReason(eventId, event.currentGameId, inviteeUserId);
    if (reason) return Response.json({ error: reason }, { status: 409 });

    const result = await createPlayerInvite({
      eventId,
      gameId: event.currentGameId,
      inviteeUserId,
      invitedByUserId: session.user.id,
      origin,
      delivery: deliver === false ? "link-only" : "auto",
    });
    return Response.json({ ok: true, ...result });
  }

  // Direct add (asInvite false) — active roster
  let target: Awaited<ReturnType<typeof resolveRosterTarget>>;
  try {
    target = await resolveRosterTarget({
      name: typeof body.name === "string" ? body.name : null,
      email: typeof body.email === "string" ? body.email : null,
      userId: typeof body.userId === "string" ? body.userId : null,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }

  const rosterState = await getActiveRosterState(eventId, event.maxPlayers, event.currentGameId);
  if (rosterState.totalCount >= event.maxPlayers * 2) {
    return Response.json({ error: `The bench is full (maximum ${event.maxPlayers} bench players).` }, { status: 400 });
  }

  // Direct add uses rosterCore — same as POST /players
  const ep = await upsertEventPlayerForRoster(eventId, target);
  const existingParticipant = await prisma.gameParticipant.findUnique({
    where: { gameId_eventPlayerId: { gameId: event.currentGameId, eventPlayerId: ep.id } },
    select: { archivedAt: true, status: true },
  });
  if (existingParticipant && !existingParticipant.archivedAt && existingParticipant.status !== "pending") {
    return Response.json({ error: `"${target.name}" is already in the list.` }, { status: 409 });
  }

  await upsertGameParticipantForRoster({ gameId: event.currentGameId, eventPlayerId: ep.id, status: "active" });
  await prisma.player.upsert({
    where: { eventId_name: { eventId, name: target.name } },
    create: { eventId, name: target.name, userId: target.userId, order: rosterState.totalCount },
    update: { userId: target.userId ?? undefined, archivedAt: null },
  });
  await syncGamePayments(event.currentGameId, eventId);
  if (rosterState.activeCount < event.maxPlayers) {
    await addPlayerToTeams(eventId, target.name, event.currentGameId);
    await validateTeams(eventId, event.maxPlayers, event.currentGameId);
  }

  return Response.json({ ok: true, name: target.name, userId: target.userId });
};
