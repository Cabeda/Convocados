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
import { archiveAndLeave } from "../../../../lib/leave.server";
import { balanceTeams } from "../../../../lib/elo.server";
import { enqueuePushSetupHintSafe } from "../../../../lib/pushSetupHint";
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
 * If teams have been generated, add a player to the appropriate team.
 * When the event has balanced=true, triggers a full rebalance (minimum swaps).
 * Otherwise, adds to the team with fewer players.
 */
export async function addPlayerToTeams(eventId: string, playerName: string) {
  const teams = await prisma.teamResult.findMany({
    where: { eventId },
    include: { members: true },
  });
  if (teams.length === 0) return; // no teams generated yet

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { balanced: true, maxPlayers: true, teamOneName: true, teamTwoName: true } });

  if (event?.balanced && teams.length === 2) {
    // Full rebalance: include all current members + new player
    const allPlayers = await prisma.player.findMany({
      where: { eventId, archivedAt: null },
      orderBy: { order: "asc" },
      take: event.maxPlayers,
    });
    const activeNames = new Set(allPlayers.map(p => p.name));
    // Only rebalance if new player is in active range
    if (activeNames.has(playerName)) {
      const ratings = await prisma.playerRating.findMany({ where: { eventId } });
      const ratingMap = new Map(ratings.map((r) => [r.name, r.rating]));
      const playersWithRatings = [...activeNames].map((name) => ({
        name,
        rating: ratingMap.get(name) ?? 1000,
      }));
      const newMatches = balanceTeams(playersWithRatings, [event.teamOneName, event.teamTwoName]);

      await prisma.$transaction([
        prisma.teamMember.deleteMany({ where: { teamResultId: { in: teams.map(t => t.id) } } }),
        ...newMatches.flatMap((match) => {
          const teamId = teams.find(t => t.name === match.team)?.id;
          if (!teamId) return [];
          return match.players.map((p) =>
            prisma.teamMember.create({ data: { name: p.name, order: p.order, teamResultId: teamId } })
          );
        }),
      ]);
      return;
    }
  }

  // Non-balanced: just add to smaller team
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
 * When the event has balanced=true, triggers a full rebalance instead of a single swap.
 */
export async function removePlayerFromTeams(eventId: string, playerName: string, promotedName?: string) {
  const teams = await prisma.teamResult.findMany({
    where: { eventId },
    include: { members: true },
  });
  if (teams.length === 0) return;

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { balanced: true, maxPlayers: true, teamOneName: true, teamTwoName: true } });

  // Balanced mode: full rebalance with current active players (excluding the leaving one, including promoted)
  if (event?.balanced && teams.length === 2) {
    const allPlayers = await prisma.player.findMany({
      where: { eventId, archivedAt: null },
      orderBy: { order: "asc" },
      take: event.maxPlayers,
    });
    const activeNames = allPlayers.map(p => p.name).filter(n => n !== playerName);
    if (promotedName && !activeNames.includes(promotedName)) {
      activeNames.push(promotedName);
    }

    if (activeNames.length >= 2) {
      const ratings = await prisma.playerRating.findMany({ where: { eventId } });
      const ratingMap = new Map(ratings.map((r) => [r.name, r.rating]));
      const playersWithRatings = activeNames.map((name) => ({
        name,
        rating: ratingMap.get(name) ?? 1000,
      }));
      const newMatches = balanceTeams(playersWithRatings, [event.teamOneName, event.teamTwoName]);

      await prisma.$transaction([
        prisma.teamMember.deleteMany({ where: { teamResultId: { in: teams.map(t => t.id) } } }),
        ...newMatches.flatMap((match) => {
          const teamId = teams.find(t => t.name === match.team)?.id;
          if (!teamId) return [];
          return match.players.map((p) =>
            prisma.teamMember.create({ data: { name: p.name, order: p.order, teamResultId: teamId } })
          );
        }),
      ]);
      return;
    }
  }

  // Non-balanced: manual remove + optional promote
  let promotedTeamId: string | null = null;

  for (const team of teams) {
    const member = team.members.find((m) => m.name === playerName);
    if (!member) continue;

    await prisma.teamMember.delete({ where: { id: member.id } });

    const remaining = team.members
      .filter((m) => m.id !== member.id)
      .sort((a, b) => a.order - b.order);
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].order !== i) {
        await prisma.teamMember.update({ where: { id: remaining[i].id }, data: { order: i } });
      }
    }

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

  // Non-balanced: try single swap for minor improvement
  if (promotedName && promotedTeamId) {
    const eventCheck = await prisma.event.findUnique({ where: { id: eventId }, select: { balanced: true } });
    if (eventCheck?.balanced) {
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
      // ── P2002 merge / re-add logic ─────────────────────────────────────
      const existing = await prisma.player.findUnique({
        where: { eventId_name: { eventId, name: trimmed } },
        select: { id: true, userId: true, order: true, archivedAt: true },
      });
      if (existing?.archivedAt) {
        // ── Re-add: un-archive + place at end of list + reset Rsvp=yes ─
        // New joiners go to the end of the list (the "Queue" mental model).
        // A re-add follows the same rule — the player loses their prior slot.
        const maxOrder = await prisma.player.aggregate({
          where: { eventId, archivedAt: null },
          _max: { order: true },
        });
        const newOrder = (maxOrder._max.order ?? -1) + 1;
        const reactivatedUserId = resolvedUser?.id ?? existing.userId;
        await prisma.player.update({
          where: { id: existing.id },
          data: {
            archivedAt: null,
            order: newOrder,
            ...(resolvedUser && !existing.userId ? { userId: resolvedUser.id } : {}),
          },
        });
        if (reactivatedUserId) {
          await prisma.rsvp.upsert({
            where: { userId_eventId: { userId: reactivatedUserId, eventId } },
            create: { eventId, userId: reactivatedUserId, status: "yes", respondedAt: new Date() },
            update: { status: "yes", respondedAt: new Date() },
          });
        } else {
          // Guest re-add: reset their guest Rsvp to "yes" if it was "no".
          await prisma.rsvp.updateMany({
            where: { playerId: existing.id, status: "no" },
            data: { status: "yes", respondedAt: new Date() },
          });
        }
        return Response.json({ ok: true, invited: null, resolvedName: trimmed, reactivated: true });
      }
      // ── ADR 0016: game-scoped re-join after recurring reset ─────────────
      // Player record exists at event level (from last week) but may not be in
      // the current game yet. If so, add them to the new game instead of erroring.
      if (existing && !existing.archivedAt && event.currentGameId) {
        const eventPlayer = await prisma.eventPlayer.upsert({
          where: { eventId_name: { eventId, name: trimmed } },
          create: { eventId, name: trimmed, userId: linkedUserId ?? existing.userId },
          update: {},
        });
        const alreadyInGame = await prisma.gameParticipant.findUnique({
          where: { gameId_eventPlayerId: { gameId: event.currentGameId, eventPlayerId: eventPlayer.id } },
        });
        if (!alreadyInGame) {
          const gpCount = await prisma.gameParticipant.count({
            where: { gameId: event.currentGameId, archivedAt: null },
          });
          await prisma.gameParticipant.create({
            data: { gameId: event.currentGameId, eventPlayerId: eventPlayer.id, order: gpCount },
          });
          // Link user if not already linked
          if (linkedUserId && !existing.userId) {
            await prisma.player.update({ where: { id: existing.id }, data: { userId: linkedUserId } });
          }
          return Response.json({ ok: true, invited: null, resolvedName: trimmed });
        }
        // Already in the current game — fall through to duplicate error
      }

      if (resolvedUser) {
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

  // Auto-follow: when a player is linked to a user account (self-join or organizer adding a known user)
  if (linkedUserId) {
    await prisma.eventFollow.upsert({
      where: { eventId_userId: { eventId, userId: linkedUserId } },
      create: { eventId, userId: linkedUserId },
      update: {},
    });
    // First-time-follow nudge — one in-app hint per 7d per user, asking them
    // to enable device push so they actually receive game reminders.
    enqueuePushSetupHintSafe(linkedUserId, eventId);
  }

  // Auto-add player to ranking system with default ELO
  await prisma.playerRating.upsert({
    where: { eventId_name: { eventId, name: trimmed } },
    create: { eventId, name: trimmed, rating: 1000 },
    update: {},
  });

  // ADR 0016: upsert EventPlayer + create GameParticipant in current Game
  if (event.currentGameId) {
    const eventPlayer = await prisma.eventPlayer.upsert({
      where: { eventId_name: { eventId, name: trimmed } },
      create: { eventId, name: trimmed, userId: linkedUserId },
      update: {},
    });
    await prisma.gameParticipant.upsert({
      where: { gameId_eventPlayerId: { gameId: event.currentGameId, eventPlayerId: eventPlayer.id } },
      create: { gameId: event.currentGameId, eventPlayerId: eventPlayer.id, order: event.players.length },
      update: {},
    });
  }

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
    // ADR 0018: Include bench position in notification body
    const benchPosition = event.players.length - event.maxPlayers + 1;
    await enqueueNotification(eventId, "player_joined_bench", { title: event.title, key: "notifyPlayerJoinedBench", params: { name: trimmed, position: String(benchPosition) }, url, spotsLeft }, senderClientId);
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
        // ADR 0017: Send game_invite push when player is added by Owner/Admin (Tier 1, via queue)
        if (prefs.pushEnabled && prefs.gameInvitePush && linkedUserId !== session?.user?.id) {
          await enqueueNotification(eventId, "game_invite", {
            title: event.title,
            key: "notifyGameInvite",
            params: { title: event.title },
            url,
            spotsLeft,
          }, linkedUserId);
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
  } else if (spotsLeft > 0 && spotsLeft <= (event.recruitmentThreshold ?? 3) && !isOnBench) {
    // ADR 0017: "Few spots left" — Tier 1, deduped per fill-cycle (reset when player leaves)
    if (!event.fewSpotsLeftNotified) {
      await enqueueNotification(eventId, "few_spots_left", {
        title: event.title,
        key: "notifyFewSpotsLeft",
        params: { title: event.title, n: String(spotsLeft) },
        url: `${url}?action=join`,
        spotsLeft,
      }, senderClientId);
      await prisma.event.update({ where: { id: eventId }, data: { fewSpotsLeftNotified: true } });
    }
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

  let player = await prisma.player.findFirst({
    where: { id: playerId, eventId, archivedAt: null },
    include: { event: { select: { ownerId: true } } },
  });
  // ADR 0016: Event GET now returns EventPlayer IDs. Fall back to name-based lookup.
  if (!player) {
    const ep = await prisma.eventPlayer.findFirst({ where: { id: playerId, eventId } });
    if (ep) {
      player = await prisma.player.findFirst({
        where: { eventId, name: ep.name, archivedAt: null },
        include: { event: { select: { ownerId: true } } },
      });
    }
  }
  if (!player) return Response.json({ error: "Not found." }, { status: 404 });

  // Protected player check: players with userId can only be removed by themselves or the event owner.
  if (player.userId) {
    const isSelf = session?.user?.id === player.userId;
    const { isOwner, isAdmin } = await checkOwnership(request, player.event.ownerId, session, eventId);
    if (!isSelf && !isOwner && !isAdmin) {
      return Response.json({ error: "This player is account-linked and can only be removed by themselves or the event owner." }, { status: 403 });
    }
  }

  // Soft-archive + notify + log + re-index, with the warn-the-rest push gated on (48h + bench-empty).
  // Self-removal (the player is removing themselves) uses actor.kind="self" so the auto-unfollow fires.
  const isSelf = session?.user?.id && player.userId === session.user.id;
  // For unauthenticated requests, pass null as the actor id (lib skips the Rsvp audit row,
  // which has a FK to User). Real authenticated users get a FK-safe actor id.
  const actorUserId = session?.user?.id ?? player.event.ownerId ?? null;
  const result = await archiveAndLeave({
    eventId,
    playerId: player.id,
    actor: isSelf
      ? { kind: "self", userId: actorUserId }
      : { kind: "organizer", userId: actorUserId },
    origin,
  });
  return Response.json({
    ok: true,
    warned: result.warned,
    undo: result.undo,
  });
};
