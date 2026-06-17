import { Prisma } from "@prisma/client";
import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { enqueueNotification, drainNotificationQueue } from "../../../../lib/notificationQueue.server";
import { sendGameInvite, sendPlayerJoinedOwnerNotification, sendPlayerInviteToRegister } from "../../../../lib/email.server";
import { sendPushToUser } from "../../../../lib/push.server";
import { getNotificationPrefs, wantsGameInviteEmail } from "../../../../lib/notificationPrefs.server";
import { fireWebhooks } from "../../../../lib/webhook.server";
import { getSession, checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { syncPaymentsForEvent } from "../../../../lib/payments.server";
import { getOutstandingBalance, getGateBalance } from "../../../../lib/balance.server";
import { logEvent } from "../../../../lib/eventLog.server";
import { createLogger } from "../../../../lib/logger.server";
import { normalizeForMatch } from "../../../../lib/stringMatch";
import {
  IDEMPOTENCY_HEADER,
  getCachedResponse,
  hasConflictingEntry,
  hashPayload,
  makeCacheKey,
  storeCachedResponse,
  startIdempotencySweep,
} from "../../../../lib/idempotency";

const log = createLogger("players-api");

startIdempotencySweep();

/**
 * Validate that all team members are active players (order < maxPlayers).
 * Removes any invalid members from teams rather than clearing all teams.
 * Returns true if any members were removed.
 */
export async function validateTeams(eventId: string, maxPlayers: number): Promise<boolean> {
  const teams = await prisma.teamResult.findMany({
    where: { eventId },
    include: { members: true },
  });
  if (teams.length === 0) return false;

  const activePlayers = await prisma.player.findMany({
    where: { eventId },
    orderBy: { order: "asc" },
    take: maxPlayers,
    select: { name: true },
  });
  const activeNames = new Set(activePlayers.map(p => p.name));

  const idsToRemove: string[] = [];
  for (const team of teams) {
    for (const member of team.members) {
      if (!activeNames.has(member.name)) {
        idsToRemove.push(member.id);
      }
    }
  }

  if (idsToRemove.length > 0) {
    await prisma.teamMember.deleteMany({ where: { id: { in: idsToRemove } } });
    return true;
  }
  return false;
}

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
 * If the event has balanced=true, check if swapping the promoted player
 * to the other team (with one player swapping back) improves ELO balance.
 */
export async function removePlayerFromTeams(eventId: string, playerName: string, promotedName?: string) {
  const teams = await prisma.teamResult.findMany({
    where: { eventId },
    include: { members: true },
  });
  if (teams.length === 0) return;

  let promotedTeamId: string | null = null;

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
      promotedTeamId = team.id;
    }

    break;
  }

  // ELO-balanced swap: if the event is balanced and a player was promoted,
  // check if swapping the promoted player with someone on the other team
  // would reduce the ELO gap between teams.
  if (promotedName && promotedTeamId) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { balanced: true } });
    if (event?.balanced) {
      await tryBalancedSwap(eventId, promotedName, promotedTeamId);
    }
  }
}

/**
 * After a promoted player is placed on a team, check if swapping them
 * with a player on the other team would improve ELO balance.
 * Only performs the swap if it strictly reduces the gap — at most 1 swap.
 */
async function tryBalancedSwap(eventId: string, promotedName: string, promotedTeamId: string) {
  const teams = await prisma.teamResult.findMany({
    where: { eventId },
    include: { members: true },
  });
  if (teams.length !== 2) return;

  const promotedTeam = teams.find(t => t.id === promotedTeamId);
  const otherTeam = teams.find(t => t.id !== promotedTeamId);
  if (!promotedTeam || !otherTeam) return;

  // Get ELO ratings
  const ratings = await prisma.playerRating.findMany({ where: { eventId } });
  const ratingMap = new Map(ratings.map(r => [r.name, r.rating]));
  const getRating = (name: string) => ratingMap.get(name) ?? 1000;

  const promotedRating = getRating(promotedName);

  // Current team totals
  const promotedTeamTotal = promotedTeam.members.reduce((sum, m) => sum + getRating(m.name), 0);
  const otherTeamTotal = otherTeam.members.reduce((sum, m) => sum + getRating(m.name), 0);
  const currentGap = Math.abs(promotedTeamTotal - otherTeamTotal);

  // Try swapping promoted player with each player on the other team
  let bestSwap: { otherMember: typeof otherTeam.members[0]; newGap: number } | null = null;

  for (const otherMember of otherTeam.members) {
    const otherRating = getRating(otherMember.name);
    // After swap: promoted goes to other team, otherMember goes to promoted team
    const newPromotedTeamTotal = promotedTeamTotal - promotedRating + otherRating;
    const newOtherTeamTotal = otherTeamTotal - otherRating + promotedRating;
    const newGap = Math.abs(newPromotedTeamTotal - newOtherTeamTotal);

    if (newGap < currentGap && (!bestSwap || newGap < bestSwap.newGap)) {
      bestSwap = { otherMember, newGap };
    }
  }

  if (!bestSwap) return; // No swap improves balance

  // Perform the swap
  const promotedMember = promotedTeam.members.find(m => m.name === promotedName);
  if (!promotedMember) return;
  const swapTarget = bestSwap.otherMember;

  // Move promoted player to other team
  await prisma.teamMember.update({
    where: { id: promotedMember.id },
    data: { teamResultId: otherTeam.id, order: swapTarget.order },
  });

  // Move swap target to promoted team
  await prisma.teamMember.update({
    where: { id: swapTarget.id },
    data: { teamResultId: promotedTeam.id, order: promotedMember.order },
  });
}

// ── Invite email rate-limit stores ────────────────────────────────────────────
// Per-event: max 10 unique invite emails per event per 24h
// Per-sender: max 20 invite emails per authenticated user per 24h across all events
interface InviteRateEntry { emails: Set<string>; expiresAt: number }
const invitePerEventStore = new Map<string, InviteRateEntry>();
const invitePerSenderStore = new Map<string, InviteRateEntry>();
const INVITE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_INVITES_PER_EVENT = 10;
const MAX_INVITES_PER_SENDER = 20;

function canSendInviteEmail(eventId: string, senderId: string, email: string): boolean {
  const now = Date.now();
  // Per-event check
  let eventEntry = invitePerEventStore.get(eventId);
  if (!eventEntry || eventEntry.expiresAt < now) {
    eventEntry = { emails: new Set(), expiresAt: now + INVITE_WINDOW_MS };
    invitePerEventStore.set(eventId, eventEntry);
  }
  if (eventEntry.emails.size >= MAX_INVITES_PER_EVENT && !eventEntry.emails.has(email)) return false;

  // Per-sender check
  let senderEntry = invitePerSenderStore.get(senderId);
  if (!senderEntry || senderEntry.expiresAt < now) {
    senderEntry = { emails: new Set(), expiresAt: now + INVITE_WINDOW_MS };
    invitePerSenderStore.set(senderId, senderEntry);
  }
  if (senderEntry.emails.size >= MAX_INVITES_PER_SENDER && !senderEntry.emails.has(email)) return false;

  return true;
}

function recordInviteEmail(eventId: string, senderId: string, email: string): void {
  const now = Date.now();
  let eventEntry = invitePerEventStore.get(eventId);
  if (!eventEntry || eventEntry.expiresAt < now) {
    eventEntry = { emails: new Set(), expiresAt: now + INVITE_WINDOW_MS };
    invitePerEventStore.set(eventId, eventEntry);
  }
  eventEntry.emails.add(email);

  let senderEntry = invitePerSenderStore.get(senderId);
  if (!senderEntry || senderEntry.expiresAt < now) {
    senderEntry = { emails: new Set(), expiresAt: now + INVITE_WINDOW_MS };
    invitePerSenderStore.set(senderId, senderEntry);
  }
  senderEntry.emails.add(email);
}

/** Reset invite rate-limit stores. Used in tests. */
export function resetInviteRateLimitStores(): void {
  invitePerEventStore.clear();
  invitePerSenderStore.clear();
}

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const idemKey = request.headers.get(IDEMPOTENCY_HEADER);
  const sessionForIdem = idemKey ? await getSession(request) : null;
  const idemUserId = sessionForIdem?.user?.id ?? null;
  const idemPath = `/api/events/${eventId}/players`;
  const idemCacheKey = idemKey ? makeCacheKey(idemKey, idemPath, idemUserId) : null;

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.cabeda.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const session = await getSession(request);
  const senderClientId = session?.user?.id ?? request.headers.get("x-client-id") ?? undefined;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { orderBy: { order: "asc" } } },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { name, linkToAccount, email } = await request.json();

  // Idempotency replay check: if the same key + same body was already processed,
  // return the cached 2xx response. Mismatched body returns 422.
  if (idemKey && idemCacheKey) {
    const bodyHash = hashPayload({ name, linkToAccount, email } as Record<string, unknown>);
    const cached = getCachedResponse(idemCacheKey, bodyHash);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers: { "content-type": cached.contentType },
      });
    }
    if (hasConflictingEntry(idemCacheKey, bodyHash)) {
      return Response.json(
        { error: "Idempotency-Key reused with different payload" },
        { status: 422 },
      );
    }
  }

  // Optional email — used to notify a registered user or invite an unregistered
  // one to join Convocados. Validated loosely; ignored if malformed.
  const normalizedEmail = typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ? email.trim().toLowerCase()
    : null;

  // ── Resolve user by email (needed before name validation) ──────────────────
  let resolvedUser: { id: string; name: string } | null = null;
  if (normalizedEmail) {
    const found = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, name: true },
    });
    if (found) resolvedUser = found;
  }

  // ── Name resolution ────────────────────────────────────────────────────────
  // If email resolves to a registered user, always use User.name
  let trimmed: string;
  if (resolvedUser) {
    trimmed = resolvedUser.name.trim().slice(0, 50);
  } else {
    trimmed = String(name ?? "").trim().slice(0, 50);
    if (!trimmed) {
      if (normalizedEmail) {
        return Response.json({ error: "Player name is required (email does not match a registered user)." }, { status: 400 });
      }
      return Response.json({ error: "Player name is required." }, { status: 400 });
    }
  }

  // Bench cap: max bench size equals maxPlayers (total players = 2 * maxPlayers)
  const maxTotal = event.maxPlayers * 2;
  if (event.players.length >= maxTotal) {
    return Response.json(
      { error: `The bench is full (maximum ${event.maxPlayers} bench players).` },
      { status: 400 },
    );
  }

  // Resolve the userId to link, in priority order:
  //   1. Explicit linkToAccount: true from an authenticated client (QuickJoin flow)
  //   2. Email resolved to a registered user
  //   3. Auto-link: name matches exactly one registered user account
  let linkedUserId: string | null = null;
  if (linkToAccount === true && session?.user) {
    linkedUserId = session.user.id;
  } else if (resolvedUser) {
    const alreadyInEvent = await prisma.player.count({ where: { eventId, userId: resolvedUser.id } });
    if (alreadyInEvent === 0) {
      linkedUserId = resolvedUser.id;
    }
  } else {
    const target = normalizeForMatch(trimmed);
    const allUsers = await prisma.user.findMany({
      select: { id: true, name: true },
    });
    const matches = allUsers.filter((u) => normalizeForMatch(u.name) === target);
    if (matches.length === 1 && target.length > 0) {
      const candidateId = matches[0].id;
      const alreadyInEvent = await prisma.player.count({
        where: { eventId, userId: candidateId },
      });
      if (alreadyInEvent === 0) {
        linkedUserId = candidateId;
      }
    }
  }

  // Email-based invite resolution
  let notifyRegisteredUserId: string | null = null;
  let inviteUnregisteredEmail: string | null = null;
  if (normalizedEmail) {
    if (resolvedUser) {
      notifyRegisteredUserId = resolvedUser.id;
    } else {
      inviteUnregisteredEmail = normalizedEmail;
    }
  }

  // ── Payment enforcement (self-service joins only) ──────────────────────────
  const isSelfServiceJoin = linkToAccount === true && linkedUserId;
  if (isSelfServiceJoin && event.paymentEnforcementLevel !== "off") {
    const balance = await getOutstandingBalance(eventId, trimmed);
    const threshold = event.paymentGateThreshold ?? 0;

    if (event.paymentEnforcementLevel === "hard_gate") {
      const gateAmount = await getGateBalance(eventId, trimmed);
      if (gateAmount > threshold) {
        return Response.json({
          error: "You must settle your outstanding balance before joining.",
          code: "PAYMENT_GATE",
          balance,
          gateAmount,
          enforcement: "hard_gate",
          threshold,
        }, { status: 402 });
      }
    }
  }

  // Audit trail: who invited this player
  const invitedByUserId = (session?.user && linkToAccount !== true) ? session.user.id : null;

  try {
    const nextOrder = event.players.length;
    await prisma.player.create({
      data: {
        name: trimmed,
        eventId,
        order: nextOrder,
        userId: linkedUserId,
        invitedByUserId,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // ── P2002 merge logic ──────────────────────────────────────────────
      if (resolvedUser) {
        const existing = await prisma.player.findUnique({
          where: { eventId_name: { eventId, name: trimmed } },
          select: { id: true, userId: true },
        });
        if (existing) {
          if (!existing.userId) {
            // Merge: link existing unlinked player to the resolved user
            await prisma.player.update({
              where: { id: existing.id },
              data: { userId: resolvedUser.id },
            });
            return Response.json({ ok: true, invited: null, resolvedName: trimmed });
          } else if (existing.userId === resolvedUser.id) {
            return Response.json({ error: `"${trimmed}" is already in the list.` }, { status: 409 });
          } else {
            return Response.json({ error: `"${trimmed}" is already linked to a different account.` }, { status: 409 });
          }
        }
      }
      return Response.json({ error: `"${trimmed}" is already in the list.` }, { status: 409 });
    }
    throw e;
  }

  // Auto-follow: only for user-initiated actions (Quick Join)
  if (linkToAccount === true && linkedUserId) {
    await prisma.eventFollow.upsert({
      where: { eventId_userId: { eventId, userId: linkedUserId } },
      create: { eventId, userId: linkedUserId },
      update: {},
    });
  }

  // Auto-add player to ranking system with default ELO
  await prisma.playerRating.upsert({
    where: { eventId_name: { eventId, name: trimmed } },
    create: { eventId, name: trimmed, rating: 1000 },
    update: {},
  });

  // spotsLeft after adding
  const activeBefore = Math.min(event.players.length, event.maxPlayers);
  const isOnBench = event.players.length >= event.maxPlayers;
  const spotsLeft = isOnBench ? 0 : Math.max(0, event.maxPlayers - activeBefore - 1);
  const url = `${origin}/events/${eventId}`;

  // Auto-sync teams
  if (!isOnBench) {
    await addPlayerToTeams(eventId, trimmed);
  }

  await validateTeams(eventId, event.maxPlayers);

  if (isOnBench) {
    await enqueueNotification(eventId, "player_joined_bench", { title: event.title, key: "notifyPlayerJoinedBench", params: { name: trimmed }, url, spotsLeft }, senderClientId);
  } else {
    await enqueueNotification(eventId, "player_joined", { title: event.title, key: "notifyPlayerJoined", params: { name: trimmed }, url, spotsLeft }, senderClientId);
  }

  if (!process.env.VITEST) {
    await drainNotificationQueue().catch((err) => {
      log.error({ eventId, err }, "Failed to drain notification queue");
    });
  }

  // Send game invite email to the joining player if they have a linked account
  if (linkedUserId) {
    const linkedUser = await prisma.user.findUnique({
      where: { id: linkedUserId },
      select: { email: true, id: true },
    });
    if (linkedUser?.email) {
      try {
        const prefs = await getNotificationPrefs(linkedUser.id);
        if (wantsGameInviteEmail(prefs)) {
          await sendGameInvite(linkedUser.email, {
            eventTitle: event.title,
            dateTime: event.dateTime.toISOString(),
            location: event.location,
            eventUrl: url,
          });
        }
      } catch (_err) {
        // Non-blocking
      }
    }
  }

  // Notify the event owner when someone joins
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

  // Fire webhooks
  const webhookData = { playerName: trimmed, isActive: !isOnBench, spotsLeft };
  fireWebhooks(eventId, "player_joined", webhookData).catch(() => {});
  if (spotsLeft === 0) {
    fireWebhooks(eventId, "game_full", webhookData).catch(() => {});
    await enqueueNotification(eventId, "game_full", { title: event.title, key: "notifyGameFullAlert", params: { name: trimmed }, url, spotsLeft: 0 }, senderClientId);
  }

  await syncPaymentsForEvent(eventId);

  logEvent(eventId, "player_added", session?.user?.name ?? null, session?.user?.id ?? null, { playerName: trimmed }).catch(() => {});

  // ── Invite-by-email: notify or email (auth-gated + rate-limited) ───────────
  let inviteResult: "notified" | "emailed" | null = null;
  const inviterName = session?.user?.name ?? null;
  const isAuthenticated = !!session?.user;

  if (isAuthenticated && notifyRegisteredUserId && notifyRegisteredUserId !== session?.user?.id) {
    try {
      await sendPushToUser(
        notifyRegisteredUserId,
        event.title,
        inviterName ? `${inviterName} added you to the game` : "You've been added to the game",
        url,
      );
      inviteResult = "notified";
    } catch (err) {
      log.error({ eventId, err }, "Failed to send invite push");
    }
  } else if (isAuthenticated && inviteUnregisteredEmail) {
    // Rate-limit check: only send if under per-event and per-sender limits
    const senderId = session!.user!.id;
    if (canSendInviteEmail(eventId, senderId, inviteUnregisteredEmail)) {
      try {
        await sendPlayerInviteToRegister(inviteUnregisteredEmail, {
          eventTitle: event.title,
          dateTime: event.dateTime.toISOString(),
          location: event.location,
          eventUrl: url,
          inviterName,
        });
        recordInviteEmail(eventId, senderId, inviteUnregisteredEmail);
        inviteResult = "emailed";
      } catch (err) {
        log.error({ eventId, err }, "Failed to send invite email");
      }
    }
  }

  const successResponse = Response.json({ ok: true, invited: inviteResult, resolvedName: trimmed });

  // Cache the 2xx response for replay on retry with the same Idempotency-Key.
  if (idemKey && idemCacheKey) {
    const bodyHash = hashPayload({ name, linkToAccount, email } as Record<string, unknown>);
    const cloned = successResponse.clone();
    const text = await cloned.text();
    const contentType = successResponse.headers.get("content-type") ?? "application/json";
    storeCachedResponse(idemCacheKey, bodyHash, 200, text, contentType);
  }

  return successResponse;
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.cabeda.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const { playerId } = await request.json();
  const session = await getSession(request);
  const senderClientId = session?.user?.id ?? request.headers.get("x-client-id") ?? undefined;

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

  // Auto-unfollow on self-removal
  const isSelfRemoval = session?.user?.id && session.user.id === player.userId;
  if (isSelfRemoval) {
    await prisma.eventFollow.deleteMany({
      where: { eventId, userId: session.user.id },
    });
  }

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

  // Validate teams: ensure no bench players are in teams after roster change
  await validateTeams(eventId, event.maxPlayers);

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

  // Spot available: game was full before removal and now has an opening (no bench to auto-promote)
  const wasFull = event.players.length >= event.maxPlayers;
  if (wasActive && wasFull && !firstBench && spotsLeft > 0) {
    await enqueueNotification(eventId, "spot_available", { title: event.title, key: "notifySpotAvailable", params: { name: player.name }, url, spotsLeft }, senderClientId);
  }

  // Drain notification queue before responding so push is sent immediately.
  if (!process.env.VITEST) {
    await drainNotificationQueue().catch((err) => {
      log.error({ eventId, err }, "Failed to drain notification queue");
    });
  }

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
