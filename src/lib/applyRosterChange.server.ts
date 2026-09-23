/**
 * applyRosterChange seam (c5, part 3).
 *
 * The join/bench/gate/notification core of POST /api/events/:id/players,
 * extracted from the route so roster-join decisions live behind one lib
 * interface instead of a 550-line handler. The route keeps HTTP concerns
 * (rate limiting, idempotency replay, session/origin extraction, pre-body
 * guards, Response wrapping) and delegates everything after body parsing.
 *
 * Returns a framework-free `{ status, body }` result; the route wraps it
 * in a Response.
 */
import { Prisma } from "@prisma/client";
import type { Event as PrismaEvent } from "@prisma/client";
import { prisma } from "./db.server";
import { enqueueNotification, drainNotificationQueue } from "./notificationQueue.server";
import { sendGameInvite, sendPlayerJoinedOwnerNotification, sendPlayerInviteToRegister } from "./email.server";
import { sendPushToUser } from "./push.server";
import { getNotificationPrefs, wantsGameInviteEmail } from "./notificationPrefs.server";
import { fireWebhooks } from "./webhook.server";
import { syncPaymentsForEvent } from "./payments.server";
import { syncGamePayments } from "./settlement.server";
import { getOutstandingBalance, getGateBalance } from "./balance.server";
import { decidePaymentGate } from "./paymentGate";
import { logEvent } from "./eventLog.server";
import { applyFormationLayout } from "./teams";
import { createLogger } from "./logger.server";
import { normalizeForMatch } from "./stringMatch";
import { balanceTeams } from "./elo.server";
import { Randomize } from "./random";
import { enqueuePushSetupHintSafe } from "./pushSetupHint";
import { getActiveRosterState } from "./roster.server";
import { acceptPendingAccountInviteForDirectJoin } from "./invite.server";
import { upsertEventPlayerForRoster, upsertGameParticipantForRoster } from "./rosterCore.server";
import { movePlayerToEndOfList, rejoinPlayerToCurrentGame } from "./rosterChange.server";
import { addPlayerToTeams, validateTeams } from "./teamFormation.server";

const log = createLogger("players-api");

export type ApplyRosterChangeResult = {
  status: number;
  body: Record<string, unknown>;
};

export type ApplyRosterChangeSession = {
  user?: { id?: string; name?: string };
} | null;

export type ApplyRosterChangeInput = {
  eventId: string;
  origin: string;
  session: ApplyRosterChangeSession;
  /** Webhook/notification actor: session user id, x-client-id, or undefined. */
  senderClientId?: string;
  body: { name?: unknown; linkToAccount?: unknown; email?: unknown };
  /** Event pre-fetched by the route (post 404/pickup/ended guards). */
  event: PrismaEvent;
};

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

/**
 * Apply a join/re-join change to the roster: resolve the player identity,
 * enforce bench/payment/identity gates, persist Player/EventPlayer/
 * GameParticipant rows, sync teams and payments, and enqueue notifications,
 * webhooks and invite emails.
 */
export async function applyRosterChange(input: ApplyRosterChangeInput): Promise<ApplyRosterChangeResult> {
  const { eventId, origin, session, senderClientId, event } = input;
  const { name, linkToAccount, email } = input.body;

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
        return { status: 400, body: { error: "Player name is required (email does not match a registered user)." } };
      }
      return { status: 400, body: { error: "Player name is required." } };
    }
  }

  // Bench cap: max bench size equals maxPlayers (total players = 2 * maxPlayers)
  const maxTotal = event.maxPlayers * 2;
  if (rosterCount >= maxTotal) {
    return {
      status: 400,
      body: { error: `The bench is full (maximum ${event.maxPlayers} bench players).` },
    };
  }

  // Resolve the userId to link, in priority order:
  //   1. Explicit linkToAccount: true from an authenticated client (QuickJoin flow)
  //   2. Email resolved to a registered user
  //   3. Auto-link: name matches exactly one registered user account
  let linkedUserId: string | null = null;
  if (linkToAccount === true && session?.user?.id) {
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
      return { status: 409, body: { error: "Your account has conflicting player identities in this event." } };
    }
    const pendingSelfInvite = pendingSelfInvites[0];
    if (pendingSelfInvite) {
      const linkedIdentities = await prisma.eventPlayer.findMany({
        where: { eventId, userId: session.user.id },
        select: { id: true },
      });
      if (linkedIdentities.some((identity) => identity.id !== pendingSelfInvite.eventPlayerId)) {
        return { status: 409, body: { error: "Your account has conflicting player identities in this event." } };
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
      return {
        status: 402,
        body: {
          error: "You must settle your outstanding balance before joining.",
          code: "PAYMENT_GATE",
          balance,
          gateAmount,
          enforcement: "hard_gate",
          threshold,
        },
      };
    }
  }

  // Audit trail: who invited this player
  const invitedByUserId = (session?.user?.id && linkToAccount !== true) ? session.user.id : null;

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
        const reactivatedUserId = resolvedUser?.id ?? existing.userId;
        await movePlayerToEndOfList(eventId, existing.id, {
          reactivate: true,
          linkUserId: resolvedUser && !existing.userId ? resolvedUser.id : null,
        });
        if (event.currentGameId) {
          const ep = await upsertEventPlayerForRoster(
            eventId,
            { name: trimmed, userId: reactivatedUserId, user: reactivatedUserId ? { id: reactivatedUserId, name: trimmed } : null },
          );
          // Restore the GameParticipant too — a previous leave archived it, and
          // without this the re-added player stays invisible on the game list.
          await rejoinPlayerToCurrentGame(event.currentGameId, ep.id);
        }
        // Bug fix: re-activated players must be added to teams if within active range
        const readdIsOnBench = activeBefore >= event.maxPlayers;
        if (!readdIsOnBench) {
          await addPlayerToTeams(eventId, trimmed, event.currentGameId);
          await autoRandomizeIfFull(eventId, event.maxPlayers, event.currentGameId);
        }
        notifyPlayerJoined(event, trimmed, activeBefore, joinActor);
        return { status: 200, body: { ok: true, invited: null, resolvedName: trimmed, reactivated: true, anonymous: linkedUserId === null } };
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
            return { status: 409, body: { error: "This player is linked to a different account." } };
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
          return { status: 200, body: { ok: true, invited: null, resolvedName: trimmed, anonymous: false } };
        }
        if (alreadyInGame && alreadyInGame.archivedAt) {
          // Re-join after a leave: the GameParticipant was soft-archived by the
          // leave flow. Un-archive it (at the end of the list) instead of
          // falling through to the 409 "already in the list" error.
          await rejoinPlayerToCurrentGame(event.currentGameId, eventPlayer.id);
          // Move player to end of list — same rule as a fresh re-join
          await movePlayerToEndOfList(eventId, existing.id, {
            linkUserId: linkedUserId && !existing.userId ? linkedUserId : null,
          });
          notifyPlayerJoined(event, trimmed, activeBefore, joinActor);
          return { status: 200, body: { ok: true, invited: null, resolvedName: trimmed, anonymous: linkedUserId === null } };
        }
        if (!alreadyInGame) {
          await rejoinPlayerToCurrentGame(event.currentGameId, eventPlayer.id);
          // Move player to end of list — their old order is stale from the previous game
          await movePlayerToEndOfList(eventId, existing.id, {
            linkUserId: linkedUserId && !existing.userId ? linkedUserId : null,
          });
          // Bug fix: re-joining players must be added to teams if within active range
          const rejoinIsOnBench = activeBefore >= event.maxPlayers;
          if (!rejoinIsOnBench) {
            await addPlayerToTeams(eventId, trimmed, event.currentGameId);
            await autoRandomizeIfFull(eventId, event.maxPlayers, event.currentGameId);
          }
          notifyPlayerJoined(event, trimmed, activeBefore, joinActor);
          return { status: 200, body: { ok: true, invited: null, resolvedName: trimmed, anonymous: linkedUserId === null } };
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
            return { status: 200, body: { ok: true, invited: null, resolvedName: trimmed, anonymous: linkedUserId === null } };
          } else if (existing.userId === resolvedUser.id) {
            return { status: 409, body: { error: `"${trimmed}" is already in the list.` } };
          } else {
            return { status: 409, body: { error: `"${trimmed}" is already linked to a different account.` } };
          }
        }
      }
      return { status: 409, body: { error: `"${trimmed}" is already in the list.` } };
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
    const senderId = session!.user!.id!;
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

  return {
    status: 200,
    body: { ok: true, invited: inviteResult, resolvedName: trimmed, anonymous: linkedUserId === null },
  };
}
