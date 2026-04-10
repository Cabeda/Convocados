import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { enqueueNotification, drainNotificationQueue } from "../../../../lib/notificationQueue.server";
import { sendGameInvite, sendPlayerJoinedOwnerNotification } from "../../../../lib/email.server";
import { getNotificationPrefs, wantsGameInviteEmail } from "../../../../lib/notificationPrefs.server";
import { fireWebhooks } from "../../../../lib/webhook.server";
import { getSession, checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { syncPaymentsForEvent } from "../../../../lib/payments.server";
import { logEvent } from "../../../../lib/eventLog.server";

/**
 * If teams have been generated, add a player to the team with fewer members.
 */
export async function addPlayerToTeams(eventId: string, playerName: string) {
  const teams = await prisma.teamResult.findMany({
    where: { eventId },
    include: { members: true },
  });
  if (teams.length === 0) return; // no teams generated yet

  // Pick the team with fewer players
  const sorted = [...teams].sort((a, b) => a.members.length - b.members.length);
  const target = sorted[0];

  await prisma.teamMember.create({
    data: {
      name: playerName,
      order: target.members.length,
      teamResultId: target.id,
    },
  });
}

/**
 * If teams have been generated, remove a player from their team.
 * If a promoted bench player name is given, slot them into the same team.
 */
export async function removePlayerFromTeams(eventId: string, playerName: string, promotedName?: string) {
  const teams = await prisma.teamResult.findMany({
    where: { eventId },
    include: { members: true },
  });
  if (teams.length === 0) return;

  for (const team of teams) {
    const member = team.members.find((m) => m.name === playerName);
    if (!member) continue;

    // Remove the player
    await prisma.teamMember.delete({ where: { id: member.id } });

    // Re-index remaining members
    const remaining = team.members
      .filter((m) => m.id !== member.id)
      .sort((a, b) => a.order - b.order);
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].order !== i) {
        await prisma.teamMember.update({ where: { id: remaining[i].id }, data: { order: i } });
      }
    }

    // If a bench player was promoted, add them to this same team
    if (promotedName) {
      await prisma.teamMember.create({
        data: {
          name: promotedName,
          order: remaining.length,
          teamResultId: team.id,
        },
      });
    }

    break;
  }
}

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.fly.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const session = await getSession(request);
  const senderClientId = request.headers.get("x-client-id") ?? session?.user?.id ?? undefined;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { orderBy: { order: "asc" } } },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { name, linkToAccount } = await request.json();
  const trimmed = String(name ?? "").trim().slice(0, 50);
  if (!trimmed) return Response.json({ error: "Player name is required." }, { status: 400 });

  // Bench cap: max bench size equals maxPlayers (total players = 2 * maxPlayers)
  const maxTotal = event.maxPlayers * 2;
  if (event.players.length >= maxTotal) {
    return Response.json(
      { error: `The bench is full (maximum ${event.maxPlayers} bench players).` },
      { status: 400 },
    );
  }

  // Only link userId when the client explicitly requests it and user is authenticated
  const shouldLink = linkToAccount === true && !!session?.user;

  try {
    const nextOrder = event.players.length;
    await prisma.player.create({
      data: {
        name: trimmed,
        eventId,
        order: nextOrder,
        userId: shouldLink ? session.user.id : null,
      },
    });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return Response.json({ error: `"${trimmed}" is already in the list.` }, { status: 409 });
    }
    throw e;
  }

  // Auto-add player to ranking system with default ELO (upsert to avoid overwriting existing ratings)
  await prisma.playerRating.upsert({
    where: { eventId_name: { eventId, name: trimmed } },
    create: { eventId, name: trimmed, rating: 1000 },
    update: {},
  });

  // spotsLeft after adding: if going to bench, active count unchanged
  const activeBefore = Math.min(event.players.length, event.maxPlayers);
  const isOnBench = event.players.length >= event.maxPlayers;
  const spotsLeft = isOnBench ? 0 : Math.max(0, event.maxPlayers - activeBefore - 1);
  const url = `${origin}/events/${eventId}`;

  // Auto-sync teams: if player is active (not bench), add to smaller team
  if (!isOnBench) {
    await addPlayerToTeams(eventId, trimmed);
  }

  if (isOnBench) {
    await enqueueNotification(eventId, "player_joined_bench", { title: event.title, key: "notifyPlayerJoinedBench", params: { name: trimmed }, url, spotsLeft }, senderClientId);
  } else {
    await enqueueNotification(eventId, "player_joined", { title: event.title, key: "notifyPlayerJoined", params: { name: trimmed }, url, spotsLeft }, senderClientId);
  }

  // Drain notification queue immediately so push is sent in near-real-time
  drainNotificationQueue().catch(() => {});

  // Send game invite email to the joining player if they have a linked account
  if (shouldLink && session?.user?.email) {
    try {
      const prefs = await getNotificationPrefs(session.user.id);
      if (wantsGameInviteEmail(prefs)) {
        await sendGameInvite(session.user.email, {
          eventTitle: event.title,
          dateTime: event.dateTime.toISOString(),
          location: event.location,
          eventUrl: url,
        });
      }
    } catch (err) {
      // Non-blocking — don't fail the join if email fails
    }
  }

  // Notify the event owner when someone joins (skip if owner is the one joining)
  if (event.ownerId && event.ownerId !== session?.user?.id) {
    try {
      const owner = await prisma.user.findUnique({ where: { id: event.ownerId }, select: { email: true, id: true } });
      if (owner?.email) {
        const ownerPrefs = await getNotificationPrefs(owner.id);
        if (wantsGameInviteEmail(ownerPrefs)) {
          await sendPlayerJoinedOwnerNotification(owner.email, {
            eventTitle: event.title,
            playerName: trimmed,
            spotsLeft,
            eventUrl: url,
          });
        }
      }
    } catch {
      // Non-blocking
    }
  }

  // Fire webhooks (non-blocking)
  const webhookData = { playerName: trimmed, isActive: !isOnBench, spotsLeft };
  fireWebhooks(eventId, "player_joined", webhookData).catch(() => {});
  if (spotsLeft === 0) {
    fireWebhooks(eventId, "game_full", webhookData).catch(() => {});
  }

  // Recalculate payment shares if a cost is set
  await syncPaymentsForEvent(eventId);


  logEvent(eventId, "player_added", session?.user?.name ?? trimmed, session?.user?.id ?? null, { playerName: trimmed }).catch(() => {});

  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.fly.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const { playerId } = await request.json();
  const session = await getSession(request);
  const senderClientId = request.headers.get("x-client-id") ?? session?.user?.id ?? undefined;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { orderBy: { order: "asc" } } },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const playerIndex = event.players.findIndex((p) => p.id === playerId);
  const player = event.players[playerIndex];
  if (!player) return Response.json({ error: "Not found." }, { status: 404 });

  // Protected player check: players with userId can only be removed by themselves or the event owner
  if (player.userId) {
    const isSelf = session?.user?.id === player.userId;
    const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, eventId);
    if (!isSelf && !isOwner && !isAdmin) {
      return Response.json({ error: "This player is account-linked and can only be removed by themselves or the event owner." }, { status: 403 });
    }
  }

  const wasActive = playerIndex < event.maxPlayers;
  const firstBench = event.players[event.maxPlayers];

  await prisma.player.delete({ where: { id: playerId, eventId } });

  // Re-index remaining player orders
  const remaining = event.players.filter((p) => p.id !== playerId);
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].order !== i) {
      await prisma.player.update({ where: { id: remaining[i].id }, data: { order: i } });
    }
  }

  // Auto-sync teams: remove player, optionally promote bench player into their team
  if (wasActive) {
    await removePlayerFromTeams(eventId, player.name, firstBench?.name);
  }

  // spotsLeft after removal
  const activeAfter = wasActive
    ? firstBench ? event.maxPlayers : Math.min(event.players.length - 1, event.maxPlayers)
    : Math.min(event.players.length - 1, event.maxPlayers);
  const spotsLeft = Math.max(0, event.maxPlayers - activeAfter);

  const url = `${origin}/events/${eventId}`;
  if (!wasActive) {
    await enqueueNotification(eventId, "player_left_bench", { title: event.title, key: "notifyPlayerLeftBench", params: { name: player.name }, url, spotsLeft }, senderClientId);
  } else if (firstBench) {
    await enqueueNotification(eventId, "player_left_promoted", { title: event.title, key: "notifyPlayerLeftPromoted", params: { left: player.name, promoted: firstBench.name }, url, spotsLeft }, senderClientId);
  } else {
    await enqueueNotification(eventId, "player_left", { title: event.title, key: "notifyPlayerLeft", params: { name: player.name }, url, spotsLeft }, senderClientId);
  }

  // Drain notification queue immediately so push is sent in near-real-time
  drainNotificationQueue().catch(() => {});

  // Fire webhooks (non-blocking)
  fireWebhooks(eventId, "player_left", { playerName: player.name, spotsLeft }).catch(() => {});

  // Recalculate payment shares if a cost is set
  await syncPaymentsForEvent(eventId);


  logEvent(eventId, "player_removed", session?.user?.name ?? null, session?.user?.id ?? null, { playerName: player.name }).catch(() => {});

  // Return undo data so the client can restore the player within a time window
  return Response.json({
    ok: true,
    undo: {
      name: player.name,
      order: playerIndex,
      userId: player.userId ?? null,
      removedAt: Date.now(),
    },
  });
};
