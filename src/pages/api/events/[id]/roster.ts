import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession, checkEventAdmin } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { isGameEnded } from "~/lib/gameStatus";
import { createPlayerInvite, createGuestPlayerInvite } from "~/lib/invite.server";
import { getNotificationPrefs, wantsInvites } from "~/lib/notificationPrefs.server";
import { resolveRosterTarget, upsertEventPlayerForRoster } from "~/lib/rosterCore.server";
import { applyRosterChange } from "~/lib/applyRosterChange.server";

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
  // Full row: the join seam reads title/location/timezone for notifications,
  // emails and webhooks, so a narrow select would silently degrade them.
  const event = await prisma.event.findUnique({ where: { id: eventId } });
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

  // Direct add goes through the same post-body core as POST /players: writes,
  // capacity notifications, invite email/push, owner email, webhooks and the
  // cancelled/ended Game guards all live in applyRosterChange (#1793).
  const result = await applyRosterChange({
    eventId,
    origin,
    session,
    body: { name: target.name, userId: target.userId, linkToAccount: false },
    event,
  });
  if (result.status !== 200) {
    return Response.json(result.body, { status: result.status });
  }

  return Response.json({
    ok: true,
    name: (result.body.resolvedName as string | undefined) ?? target.name,
    userId: target.userId,
  });
};
