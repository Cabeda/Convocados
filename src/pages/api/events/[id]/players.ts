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
import { syncGamePayments } from "../../../../lib/settlement.server";
import { getOutstandingBalance, getGateBalance } from "../../../../lib/balance.server";
import { decidePaymentGate } from "../../../../lib/paymentGate";
import { logEvent } from "../../../../lib/eventLog.server";
import { applyFormationLayout } from "../../../../lib/teams";
import { createLogger } from "../../../../lib/logger.server";
import { normalizeForMatch } from "../../../../lib/stringMatch";
import { isGameEnded } from "../../../../lib/gameStatus";
import { archiveAndLeave } from "../../../../lib/leave.server";
import { balanceTeams } from "../../../../lib/elo.server";
import { Randomize } from "../../../../lib/random";
import { nextGameParticipantOrder } from "../../../../lib/game.server";
import { enqueuePushSetupHintSafe } from "../../../../lib/pushSetupHint";
import { getActiveRosterState } from "../../../../lib/roster.server";
import { acceptPendingAccountInviteForDirectJoin } from "../../../../lib/invite.server";
import { upsertEventPlayerForRoster, upsertGameParticipantForRoster } from "../../../../lib/rosterCore.server";
import {
  IDEMPOTENCY_HEADER,
  getCachedResponse,
  hasConflictingEntry,
  hashPayload,
  makeCacheKey,
  storeCachedResponse,
  startIdempotencySweep,
} from "../../../../lib/idempotency";
import { validateTeams, addPlayerToTeams } from "../../../../lib/teamFormation.server";

const log = createLogger("players-api");

startIdempotencySweep();


/**
 * Auto-randomize teams when the game becomes full (active players === maxPlayers)
 * and no teams have been generated yet. The manual "Randomize" button remains
 * available at all times for re-randomization.
 */
async function autoRandomizeIfFull(eventId: string, maxPlayers: number, currentGameId?: string | null): Promise<void> {
  // Only trigger when no teams exist yet
  const existingTeams = await prisma.teamResult.count({ where: { eventId } });
  if (existingTeams > 0) return;

  // Count active players
  const activeNames = (await getActiveRosterState(eventId, maxPlayers, currentGameId)).activeNames;
  if (activeNames.size < maxPlayers) return;

  // Game is full and no teams — auto-generate
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { balanced: true, teamOneName: true, teamTwoName: true, sport: true },
  });
  if (!event) return;

  const players = [...activeNames];
  let matches;

  if (event.balanced) {
    const ratings = await prisma.playerRating.findMany({ where: { eventId } });
    const ratingMap = new Map(ratings.map((r) => [r.name, r.rating]));
    const playersWithRatings = players.map((name) => ({
      name,
      rating: ratingMap.get(name) ?? 1000,
    }));
    matches = balanceTeams(playersWithRatings, [event.teamOneName, event.teamTwoName]);
  } else {
    matches = Randomize(players, [event.teamOneName, event.teamTwoName]);
  }

  await prisma.$transaction([
    ...applyFormationLayout(matches, event.sport).map((match) =>
      prisma.teamResult.create({
        data: {
          name: match.team,
          formation: match.formation ?? null,
          eventId,
          members: { create: match.players.map((p) => ({ name: p.name, order: p.order, slot: p.slot ?? null })) },
        },
      })
    ),
  ]);

  logEvent(eventId, "teams_randomized", null, null, { balanced: event.balanced, playerCount: players.length, auto: true }).catch(() => {});
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

/**
 * Fire player_joined (+ game_full when the roster fills) webhooks and log the
 * player_added activity for ANY join path. The re-join paths (after a leave or
 * a recurring reset) used to return early and silently skipped both — the
 * external gateway (e.g. a WhatsApp bridge) never heard about returning players.
 */
function notifyPlayerJoined(event: { id: string; maxPlayers: number }, playerName: string, activeBefore: number, actor: string) {
  // activeBefore is the ACTIVE roster count BEFORE this join (game-scoped under
  // ADR 0016). Legacy Player order must not be used here: it accumulates across
  // recurring occurrences and would wrongly fire game_full on a 4/10 roster.
  const isActive = activeBefore < event.maxPlayers;
  const spotsLeft = isActive ? Math.max(0, event.maxPlayers - activeBefore - 1) : 0;
  const data = { playerName, isActive, spotsLeft, actor };
  fireWebhooks(event.id, "player_joined", data).catch(() => {});
  if (spotsLeft === 0) fireWebhooks(event.id, "game_full", data).catch(() => {});
  logEvent(event.id, "player_added", null, null, { playerName }).catch(() => {});
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
    include: { players: { where: { archivedAt: null }, orderBy: { order: "asc" } } },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // ADR-0021: joining an un-adopted Open Pickup is blocked until someone adopts.
  const pickupGate = await prisma.event.findUnique({
    where: { id: eventId },
    select: { source: true, ownerId: true },
  });
  if (pickupGate?.source === "playtomic" && pickupGate.ownerId === null) {
    return Response.json(
      { error: "This is an open pickup — claim it first." },
      { status: 409 },
    );
  }

  // Once the game has ended, the roster is frozen on the event page — players
  // must not be added after kickoff. Post-game roster fixes go through the
  // game history (PATCH /history) instead.
  if (isGameEnded(event.dateTime, event.durationMinutes)) {
    return Response.json(
      { error: "The game has already ended — players can no longer be added." },
      { status: 403 },
    );
  }

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

  // ADR 0016: the authoritative roster is the current game's GameParticipant
  // rows, NOT the legacy Player rows (which accumulate across recurring
  // occurrences — 19 active rows here while the game has 4 players). Snapshot
  // the ACTIVE count BEFORE this join so spotsLeft/bench logic sees the real
  // roster and game_full fires only when the current game actually fills.
  const rosterState = await getActiveRosterState(eventId, event.maxPlayers, event.currentGameId);
  const activeBefore = rosterState.activeCount;
  const rosterCount = rosterState.totalCount;

  // Actor for the player_joined webhook payload: the session user who performed
  // the join, or "anonymous" when nobody is signed in.
  const joinActor = session?.user?.name ?? "anonymous";

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
  if (rosterCount >= maxTotal) {
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

  let pendingSelfInviteEventPlayerId: string | null = null;
  if (linkToAccount === true && session?.user?.id && event.currentGameId) {
    const pendingSelfInvites = await prisma.playerInvite.findMany({
      where: {
        gameId: event.currentGameId,
        status: "pending",
        eventPlayer: { eventId, userId: session.user.id },
      },
      select: { eventPlayerId: true, eventPlayer: { select: { name: true } } },
    });
    if (pendingSelfInvites.length > 1) {
      return Response.json({ error: "Your account has conflicting player identities in this event." }, { status: 409 });
    }
    const pendingSelfInvite = pendingSelfInvites[0];
    if (pendingSelfInvite) {
      const linkedIdentities = await prisma.eventPlayer.findMany({
        where: { eventId, userId: session.user.id },
        select: { id: true },
      });
      if (linkedIdentities.some((identity) => identity.id !== pendingSelfInvite.eventPlayerId)) {
        return Response.json({ error: "Your account has conflicting player identities in this event." }, { status: 409 });
      }
      // The invitation's account-linked identity is authoritative. The typed
      // name is only input context and must not create a second identity.
      pendingSelfInviteEventPlayerId = pendingSelfInvite.eventPlayerId;
      trimmed = pendingSelfInvite.eventPlayer.name;
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
    const gateAmount = event.paymentEnforcementLevel === "hard_gate"
      ? await getGateBalance(eventId, trimmed)
      : balance.amount;

    if (decidePaymentGate({
      enforcement: event.paymentEnforcementLevel,
      isSelfService: true,
      outstandingAmount: balance.amount,
      gateAmount,
      threshold,
    }) === "block") {
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

  // Audit trail: who invited this player
  const invitedByUserId = (session?.user && linkToAccount !== true) ? session.user.id : null;

  try {
    // ponytail: use max(order)+1 to avoid landing in gaps from past removals/reorders
    const maxOrder = await prisma.player.aggregate({
      where: { eventId, archivedAt: null },
      _max: { order: true },
    });
    const nextOrder = (maxOrder._max.order ?? -1) + 1;
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
        if (event.currentGameId) {
          const ep = await upsertEventPlayerForRoster(
            eventId,
            { name: trimmed, userId: reactivatedUserId, user: reactivatedUserId ? { id: reactivatedUserId, name: trimmed } : null },
          );
          await prisma.rsvp.upsert({
            where: { eventPlayerId_gameId: { eventPlayerId: ep.id, gameId: event.currentGameId } },
            create: { eventPlayerId: ep.id, gameId: event.currentGameId, status: "yes", respondedAt: new Date() },
            update: { status: "yes", respondedAt: new Date() },
          });
          // Restore the GameParticipant too — a previous leave archived it, and
          // without this the re-added player stays invisible on the game list.
          const gpOrder = await nextGameParticipantOrder(event.currentGameId);
          await upsertGameParticipantForRoster({ gameId: event.currentGameId, eventPlayerId: ep.id, status: "active", order: gpOrder });
        }
        // Bug fix: re-activated players must be added to teams if within active range
        const readdIsOnBench = activeBefore >= event.maxPlayers;
        if (!readdIsOnBench) {
          await addPlayerToTeams(eventId, trimmed, event.currentGameId);
          await autoRandomizeIfFull(eventId, event.maxPlayers, event.currentGameId);
        }
        notifyPlayerJoined(event, trimmed, activeBefore, joinActor);
        return Response.json({ ok: true, invited: null, resolvedName: trimmed, reactivated: true, anonymous: linkedUserId === null });
      }
      // ── ADR 0016: game-scoped re-join after recurring reset ─────────────
      // Player record exists at event level (from last week) but may not be in
      // the current game yet. If so, add them to the new game instead of erroring.
      if (existing && !existing.archivedAt && event.currentGameId) {
        const eventPlayer = await upsertEventPlayerForRoster(
          eventId,
          { name: trimmed, userId: linkedUserId ?? existing.userId, user: linkedUserId ? { id: linkedUserId, name: trimmed } : null },
        );
        const alreadyInGame = await prisma.gameParticipant.findUnique({
          where: { gameId_eventPlayerId: { gameId: event.currentGameId, eventPlayerId: eventPlayer.id } },
        });
        if (pendingSelfInviteEventPlayerId === eventPlayer.id && alreadyInGame) {
          if (existing.userId && existing.userId !== linkedUserId) {
            return Response.json({ error: "This player is linked to a different account." }, { status: 409 });
          }
          await prisma.player.update({
            where: { id: existing.id },
            data: { userId: linkedUserId },
          });
          await upsertGameParticipantForRoster({ gameId: event.currentGameId, eventPlayerId: eventPlayer.id, status: "active" });
          await acceptPendingAccountInviteForDirectJoin({
            eventId,
            gameId: event.currentGameId,
            userId: linkedUserId!,
          });
          await prisma.eventFollow.upsert({
            where: { eventId_userId: { eventId, userId: linkedUserId! } },
            create: { eventId, userId: linkedUserId! },
            update: {},
          });
          enqueuePushSetupHintSafe(linkedUserId!, eventId);
          const promotedIsOnBench = activeBefore >= event.maxPlayers;
          if (!promotedIsOnBench) {
            await addPlayerToTeams(eventId, trimmed, event.currentGameId);
            await autoRandomizeIfFull(eventId, event.maxPlayers, event.currentGameId);
          }
          notifyPlayerJoined(event, trimmed, activeBefore, joinActor);
          return Response.json({ ok: true, invited: null, resolvedName: trimmed, anonymous: false });
        }
        if (alreadyInGame && alreadyInGame.archivedAt) {
          // Re-join after a leave: the GameParticipant was soft-archived by the
          // leave flow. Un-archive it (at the end of the list) instead of
          // falling through to the 409 "already in the list" error.
          const gpOrder = await nextGameParticipantOrder(event.currentGameId);
          await upsertGameParticipantForRoster({ gameId: event.currentGameId, eventPlayerId: eventPlayer.id, status: "active", order: gpOrder });
          // Move player to end of list — same rule as a fresh re-join
          const maxOrder = await prisma.player.aggregate({
            where: { eventId, archivedAt: null },
            _max: { order: true },
          });
          const newOrder = (maxOrder._max.order ?? -1) + 1;
          await prisma.player.update({
            where: { id: existing.id },
            data: { order: newOrder, ...(linkedUserId && !existing.userId ? { userId: linkedUserId } : {}) },
          });
          // Reset stale RSVP — the leave wrote "no", the re-join means "yes"
          await prisma.rsvp.upsert({
            where: { eventPlayerId_gameId: { eventPlayerId: eventPlayer.id, gameId: event.currentGameId } },
            create: { eventPlayerId: eventPlayer.id, gameId: event.currentGameId, status: "yes", respondedAt: new Date() },
            update: { status: "yes", respondedAt: new Date() },
          });
          notifyPlayerJoined(event, trimmed, activeBefore, joinActor);
          return Response.json({ ok: true, invited: null, resolvedName: trimmed, anonymous: linkedUserId === null });
        }
        if (!alreadyInGame) {
          await upsertGameParticipantForRoster({ gameId: event.currentGameId, eventPlayerId: eventPlayer.id, status: "active" });
          // Move player to end of list — their old order is stale from the previous game
          const maxOrder = await prisma.player.aggregate({
            where: { eventId, archivedAt: null },
            _max: { order: true },
          });
          const newOrder = (maxOrder._max.order ?? -1) + 1;
          await prisma.player.update({
            where: { id: existing.id },
            data: { order: newOrder, ...(linkedUserId && !existing.userId ? { userId: linkedUserId } : {}) },
          });
          // Reset stale RSVP from previous game occurrence — write "yes" on the new game
          await prisma.rsvp.upsert({
            where: { eventPlayerId_gameId: { eventPlayerId: eventPlayer.id, gameId: event.currentGameId } },
            create: { eventPlayerId: eventPlayer.id, gameId: event.currentGameId, status: "yes", respondedAt: new Date() },
            update: { status: "yes", respondedAt: new Date() },
          });
          // Bug fix: re-joining players must be added to teams if within active range
          const rejoinIsOnBench = activeBefore >= event.maxPlayers;
          if (!rejoinIsOnBench) {
            await addPlayerToTeams(eventId, trimmed, event.currentGameId);
            await autoRandomizeIfFull(eventId, event.maxPlayers, event.currentGameId);
          }
          notifyPlayerJoined(event, trimmed, activeBefore, joinActor);
          return Response.json({ ok: true, invited: null, resolvedName: trimmed, anonymous: linkedUserId === null });
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
            return Response.json({ ok: true, invited: null, resolvedName: trimmed, anonymous: linkedUserId === null });
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

  // ADR 0016: upsert EventPlayer + create GameParticipant in current Game — single place via rosterCore
  if (event.currentGameId) {
    const eventPlayer = await upsertEventPlayerForRoster(
      eventId,
      { name: trimmed, userId: linkedUserId, user: linkedUserId ? { id: linkedUserId, name: trimmed } : null },
    );
    await upsertGameParticipantForRoster({ gameId: event.currentGameId, eventPlayerId: eventPlayer.id, status: "active" });
    if (pendingSelfInviteEventPlayerId && linkedUserId) {
      await acceptPendingAccountInviteForDirectJoin({
        eventId,
        gameId: event.currentGameId,
        userId: linkedUserId,
      });
    }
    // Payment overhaul: keep per-game payment rows in sync with the roster.
    await syncGamePayments(event.currentGameId, eventId);
  }

  // spotsLeft after adding (activeBefore snapshot from the top of the handler)
  const isOnBench = activeBefore >= event.maxPlayers;
  const spotsLeft = isOnBench ? 0 : Math.max(0, event.maxPlayers - activeBefore - 1);
  const url = `${origin}/events/${eventId}`;

  // Auto-sync teams
  if (!isOnBench) {
    await addPlayerToTeams(eventId, trimmed, event.currentGameId);
  }

  await validateTeams(eventId, event.maxPlayers, event.currentGameId);

  // Auto-randomize: first randomization triggers when game is full
  if (!isOnBench) {
    await autoRandomizeIfFull(eventId, event.maxPlayers, event.currentGameId);
  }

  if (isOnBench) {
    // ADR 0018: Include bench position in notification body
    const benchPosition = rosterCount - event.maxPlayers + 1;
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
  const webhookData = { playerName: trimmed, isActive: !isOnBench, spotsLeft, actor: joinActor };
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

  const successResponse = Response.json({ ok: true, invited: inviteResult, resolvedName: trimmed, anonymous: linkedUserId === null });

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
