/**
 * ADR 0025 — PlayerInvite lifecycle (backend).
 *
 * Model: PlayerInvite(gameId, eventPlayerId, invitedByUserId, status, token,
 * notifiedAt, respondedAt). @@unique([gameId, eventPlayerId]) — one invite per
 * player per game.
 *
 * Status flow:
 *  pending → accepted  (invitee accepts — QuickJoin path, viaInvite:true)
 *  pending → declined  (invitee declines — keeps PlayerInvite + EventPlayer shell,
 *                        removes GameParticipant + Rsvp for that game)
 *  pending → cancelled (owner/inviter retracts — silent, no webhook)
 *  pending → expired   (lazy: kickoff passed and still pending)
 *
 * Accept = QuickJoin: auto-follow, no password needed, full roster → bench with
 * a player_joined_bench notification. Accept fires player_joined (viaInvite:true).
 * Decline/retract fire nothing.
 */

import { randomBytes } from "crypto";
import { prisma } from "./db.server";
import { createLogger } from "./logger.server";
import { nextGameParticipantOrder } from "./game.server";
import { getNotificationPrefs, wantsInvites } from "./notificationPrefs.server";
import { sendPushToUser } from "./push.server";
import { fireWebhooks } from "./webhook.server";
import { enqueueNotification } from "./notificationQueue.server";
import { sendGameInvite, isEmailConfigured } from "./email.server";
import { createT, type Locale } from "./i18n";
import { checkEventAdmin } from "./auth.helpers.server";
import { upsertEventPlayerForRoster, upsertGameParticipantForRoster } from "./rosterCore.server";

const log = createLogger("invite");

export type PlayerInviteStatus = "pending" | "accepted" | "declined" | "expired" | "cancelled";

/** Notification channels an invite was delivered through (ADR 0025). */
export interface InviteChannels {
  email: boolean;
  webPush: boolean;
  appPush: boolean;
}

const NO_CHANNELS: InviteChannels = { email: false, webPush: false, appPush: false };

/** Minimum time between an invite being sent (or resent) and a resend. */
export const RESEND_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Thrown when a resend is attempted before the 24h cooldown has elapsed. */
export class InviteResendCooldownError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("This invite was sent recently. Wait before resending.");
    this.name = "InviteResendCooldownError";
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

/**
 * Which notification channels are enabled for an invitee. Each channel is true
 * only when the invitee opted in (prefs + verified email) AND a delivery
 * surface exists (email provider configured, web push subscription, app push
 * token). When all three are false the inviter should fall back to link sharing.
 */
export async function getInviteChannels(userId: string): Promise<InviteChannels> {
  const prefs = await getNotificationPrefs(userId);
  if (!wantsInvites(prefs)) return NO_CHANNELS;

  const [user, webSubs, appTokens, googleAccount] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } }),
    prisma.pushSubscription.count({ where: { userId } }),
    prisma.appPushToken.count({ where: { userId } }),
    prisma.account.findFirst({ where: { userId, providerId: "google" }, select: { id: true } }),
  ]);

  const pushWanted = prefs.pushEnabled && prefs.gameInvitePush;
  // Google users have verified email via OAuth — auto-enable email channel for invites
  // even if they haven't explicitly opted into email prefs yet. Their email is
  // already stored in User.email and is verified by Google.
  const isGoogleUser = !!googleAccount;
  const emailWanted = (prefs.emailEnabled && prefs.gameInviteEmail) || (isGoogleUser && !!user?.emailVerified);
  return {
    email: emailWanted && !!user?.email && !!user.emailVerified && isEmailConfigured(),
    webPush: pushWanted && webSubs > 0,
    appPush: pushWanted && appTokens > 0,
  };
}

/** Cryptographically random per-invite token (used for /invite/<token> links). */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Lazy expiry: mark a game's pending invites as expired once kickoff has passed.
 * Called on every invite lookup/read path so invites never outlive their game.
 */
export async function expirePendingInvites(gameId: string, now: Date = new Date()): Promise<number> {
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { dateTime: true } });
  if (!game || game.dateTime > now) return 0;
  const res = await prisma.playerInvite.updateMany({
    where: { gameId, status: "pending" },
    data: { status: "expired" },
  });
  return res.count;
}

/**
 * Create a pending PlayerInvite. The caller (API route) is responsible for the
 * preconditions: not already joined, no pending invite, invitee wants invites,
 * invitee not per-event opted-out, not rsvp=no this game, noShowStreak < 2.
 *
 * Creates an EventPlayer shell (userId-linked) when the invitee has never
 * played this event. Fires the player_invited webhook and notifies ONLY the
 * invitee (in-app + push), sets notifiedAt.
 */
export async function createPlayerInvite(opts: {
  eventId: string;
  gameId: string;
  inviteeUserId: string;
  invitedByUserId: string;
  origin: string;
}): Promise<{ inviteId: string; token: string; inviteUrl: string; channels: InviteChannels }> {
  const { eventId, gameId, inviteeUserId, invitedByUserId, origin } = opts;
  const user = await prisma.user.findUnique({
    where: { id: inviteeUserId },
    select: { id: true, name: true },
  });
  if (!user) throw new Error("Invitee not found.");

  const ep = await upsertEventPlayerForRoster(eventId, { name: user.name, userId: inviteeUserId, user }, prisma);

  const token = generateInviteToken();
  const invite = await prisma.$transaction(async (tx) => {
    // Guard: don't overwrite an active roster spot. The API route's
    // inviteBlockReason should have blocked this, but handle race/concurrency.
    const existingParticipant = await tx.gameParticipant.findUnique({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: ep.id } },
    });
    if (existingParticipant && existingParticipant.status === "active" && !existingParticipant.archivedAt) {
      throw new Error("This user is already on the player list.");
    }

    const inv = await tx.playerInvite.upsert({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: ep.id } },
      create: {
        gameId,
        eventPlayerId: ep.id,
        invitedByUserId,
        status: "pending",
        token,
        notifiedAt: new Date(),
      },
      update: {
        invitedByUserId,
        status: "pending",
        token,
        notifiedAt: new Date(),
        respondedAt: null,
      },
    });

    // ADR 0025: pending roster entry — visible to participants/owner as
    // "Invited", counts toward nothing (roster/bench/payments/teams).
    // Use upsert so re-invites after cancel/expire (which leave a pending
    // GameParticipant) don't hit the (gameId, eventPlayerId) unique constraint
    // for Tiago Magalhães repro: Unique constraint failed on (gameId, eventPlayerId).
    await upsertGameParticipantForRoster({ gameId, eventPlayerId: ep.id, status: "pending" }, tx);

    return inv;
  });

  const inviteUrl = `${origin}/invite/${token}`;

  const channels = await deliverInviteNotification({ userId: inviteeUserId, eventId, inviteUrl, inviteToken: token, invitedByUserId });
  // Persist which channels were used so admins can see delivery info on the
  // roster (and the resend cooldown can be enforced per invite).
  await prisma.playerInvite.update({
    where: { id: invite.id },
    data: {
      sentViaEmail: channels.email,
      sentViaWebPush: channels.webPush,
      sentViaAppPush: channels.appPush,
      notifiedAt: new Date(),
    },
  });
  fireWebhooks(eventId, "player_invited", { playerName: user.name, inviteUrl }).catch(() => {});

  log.info({ inviteId: invite.id, eventId, inviteeUserId, invitedByUserId, channels }, "Player invite created");
  return { inviteId: invite.id, token, inviteUrl, channels };
}

/**
 * Re-send an existing pending PlayerInvite through all currently-enabled
 * notification channels (ADR 0025). Enforces a 24h cooldown since the last
 * delivery. Allowed for the event owner, an event admin, or the original
 * inviter. The invite token is kept — previously shared links stay valid.
 */
export async function resendPlayerInvite(opts: {
  eventId: string;
  inviteId: string;
  requestedByUserId: string;
  origin: string;
}): Promise<{ inviteId: string; token: string; inviteUrl: string; channels: InviteChannels; notifiedAt: Date }> {
  const { eventId, inviteId, requestedByUserId, origin } = opts;

  let invite: { id: string; gameId: string; status: string; token: string; notifiedAt: Date | null; invitedByUserId: string; eventPlayer: { userId: string | null } } | null =
    await prisma.playerInvite.findUnique({
      where: { id: inviteId },
      select: {
        id: true,
        gameId: true,
        status: true,
        token: true,
        notifiedAt: true,
        invitedByUserId: true,
        eventPlayer: { select: { userId: true } },
      },
    });
  // Backward compat: pre-fix clients sent EventPlayer id (invited[].id) instead of
  // PlayerInvite id. Fall back to lookup by EventPlayer for the current game.
  if (!invite) {
    const eventForFallback = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
    if (eventForFallback?.currentGameId) {
      invite = await prisma.playerInvite.findFirst({
        where: { eventPlayerId: inviteId, gameId: eventForFallback.currentGameId },
        select: {
          id: true,
          gameId: true,
          status: true,
          token: true,
          notifiedAt: true,
          invitedByUserId: true,
          eventPlayer: { select: { userId: true } },
        },
      });
    }
  }
  if (!invite || invite.eventPlayer.userId === null) throw new Error("Invite not found.");
  // From here on, use the resolved invite id (handles EventPlayer-id fallback)
  const resolvedInviteId = invite.id;

  // Verify the invite belongs to this event via its game.
  const game = await prisma.game.findUnique({ where: { id: invite.gameId }, select: { eventId: true } });
  if (!game || game.eventId !== eventId) throw new Error("Invite not found.");

  const [isEventAdmin, owner] = await Promise.all([
    checkEventAdmin(eventId, requestedByUserId).catch(() => false),
    prisma.event.findUnique({ where: { id: eventId }, select: { ownerId: true } }),
  ]);
  const isOwnerOrInviter = owner?.ownerId === requestedByUserId || invite.invitedByUserId === requestedByUserId;
  if (!isOwnerOrInviter && isEventAdmin !== true) {
    throw new Error("Only the owner, an admin, or the inviter can resend an invite.");
  }
  if (invite.status !== "pending") throw new Error("This invite is no longer pending.");

  if (invite.notifiedAt) {
    const elapsed = Date.now() - invite.notifiedAt.getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      throw new InviteResendCooldownError((RESEND_COOLDOWN_MS - elapsed) / 1000);
    }
  }

  const inviteeUserId = invite.eventPlayer.userId;
  const user = await prisma.user.findUnique({ where: { id: inviteeUserId }, select: { name: true } });
  if (!user) throw new Error("Invitee not found.");

  const inviteUrl = `${origin}/invite/${invite.token}`;
  const channels = await deliverInviteNotification({ userId: inviteeUserId, eventId, inviteUrl, inviteToken: invite.token, invitedByUserId: requestedByUserId });

  const notifiedAt = new Date();
  await prisma.playerInvite.update({
    where: { id: resolvedInviteId },
    data: {
      sentViaEmail: channels.email,
      sentViaWebPush: channels.webPush,
      sentViaAppPush: channels.appPush,
      notifiedAt,
    },
  });

  fireWebhooks(eventId, "player_invited", { playerName: user.name, inviteUrl }).catch(() => {});
  log.info({ inviteId: resolvedInviteId, eventId, inviteeUserId, requestedByUserId, channels }, "Player invite resent");

  return { inviteId: resolvedInviteId, token: invite.token, inviteUrl, channels, notifiedAt };
}

async function deliverInviteNotification(opts: { userId: string; eventId: string; inviteUrl: string; inviteToken: string; invitedByUserId: string }): Promise<InviteChannels> {
  const prefs = await getNotificationPrefs(opts.userId);
  // Global kill switch: nothing is sent (no in-app row either).
  if (!wantsInvites(prefs)) return NO_CHANNELS;
  const channels = await getInviteChannels(opts.userId);

  const [event, inviterToken, inviteeUser] = await Promise.all([
    prisma.event.findUnique({ where: { id: opts.eventId }, select: { title: true, dateTime: true, location: true, sport: true } }),
    // The inviter's push locale (AppPushToken) — the push is composed by them.
    prisma.appPushToken.findFirst({ where: { userId: opts.invitedByUserId }, select: { locale: true } }),
    prisma.user.findUnique({ where: { id: opts.userId }, select: { email: true } }),
  ]);
  const title = event?.title ?? "Game";

  const key = "notifyPlayerInvited" as const;
  // In-app feed: store key + params, rendered client-side in the RECEIVER's locale.
  await prisma.inAppNotification.create({
    data: {
      userId: opts.userId,
      eventId: opts.eventId,
      type: "player_invited",
      title,
      body: `${key}:${JSON.stringify({ event: title })}`,
      url: opts.inviteUrl,
    },
  });

  if (channels.webPush || channels.appPush) {
    // Push body is composed by the inviter — render it in the INVITER's locale.
    // Tap opens the EVENT page; the inviteToken + sport/startsAt/location ride in
    // the FCM data payload so the Android app can offer Accept/Decline quick
    // actions on an informed notification (ADR 0025). The web in-app feed keeps
    // the /invite/<token> URL. Time is sent as ISO — the device renders it in
    // the receiver's own timezone/locale.
    const inviterLocale = (inviterToken?.locale as Locale) ?? "en";
    const t = createT(inviterLocale);
    sendPushToUser(opts.userId, title, t(key, { event: title }), `/events/${opts.eventId}`, {
      type: "player_invited",
      eventId: opts.eventId,
      inviteToken: opts.inviteToken,
      ...(event?.sport ? { sport: event.sport } : {}),
      ...(event ? { startsAt: event.dateTime.toISOString() } : {}),
      ...(event?.location ? { location: event.location } : {}),
    }).catch(() => {});
  }

  if (channels.email && event && inviteeUser?.email) {
    sendGameInvite(inviteeUser.email, {
      eventTitle: title,
      dateTime: event.dateTime.toISOString(),
      location: event.location,
      eventUrl: opts.inviteUrl,
    }).catch(() => {});
  }

  return channels;
}

/**
 * Accept a pending invite. Returns { status, bench } where bench=true means the
 * invitee joined the bench (roster full). Throws on invalid/expired/claimed
 * invites.
 */
export async function acceptPlayerInvite(opts: {
  token: string;
  userId: string;
  eventId: string;
  gameId: string;
  maxPlayers: number;
}): Promise<{ status: "accepted"; bench: boolean }> {
  const { token, userId, eventId, gameId, maxPlayers } = opts;

  await expirePendingInvites(gameId);

  const invite = await prisma.playerInvite.findUnique({
    where: { token },
    include: { eventPlayer: { select: { userId: true } } },
  });
  if (!invite || invite.gameId !== gameId) throw new Error("Invite not found.");
  if (invite.status !== "pending") {
    throw new Error(invite.status === "expired" ? "This invite has expired." : "This invite is no longer pending.");
  }
  if (invite.eventPlayer.userId !== userId) {
    throw new Error("This invite is not for your account.");
  }

  const existing = await prisma.gameParticipant.findUnique({
    where: { gameId_eventPlayerId: { gameId, eventPlayerId: invite.eventPlayerId } },
  });
  // Pending invites have a GameParticipant with status "pending" — accepting
  // upgrades it. Only an ACTIVE membership blocks the accept.
  if (existing && !existing.archivedAt && existing.status === "active") {
    throw new Error("You are already on the player list.");
  }

  const order = await nextGameParticipantOrder(gameId);
  const bench = order >= maxPlayers;

  await prisma.$transaction(async (tx) => {
    await tx.playerInvite.update({
      where: { id: invite.id },
      data: { status: "accepted", respondedAt: new Date() },
    });

    await tx.gameParticipant.upsert({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: invite.eventPlayerId } },
      create: { gameId, eventPlayerId: invite.eventPlayerId, order, status: "active" },
      update: { archivedAt: null, order, status: "active" },
    });

    await tx.rsvp.upsert({
      where: { eventPlayerId_gameId: { eventPlayerId: invite.eventPlayerId, gameId } },
      create: { eventPlayerId: invite.eventPlayerId, gameId, status: "yes", respondedAt: new Date() },
      update: { status: "yes", respondedAt: new Date() },
    });

    // Auto-follow on accept
    await tx.eventFollow.upsert({
      where: { eventId_userId: { eventId, userId } },
      create: { eventId, userId },
      update: {},
    });
  });

  const url = `${process.env.PUBLIC_URL ?? "https://convocados.cabeda.dev"}/events/${eventId}`;
  const [event, user] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { title: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);
  const eventTitle = event?.title ?? "Game";
  const userName = user?.name ?? "Someone";
  const spotsLeft = bench ? 0 : Math.max(0, maxPlayers - order - 1);

  if (bench) {
    const benchPosition = order - maxPlayers + 1;
    await enqueueNotification(eventId, "player_joined_bench", {
      title: eventTitle,
      key: "notifyPlayerJoinedBench",
      params: { name: userName, position: String(benchPosition) },
      url,
      spotsLeft: 0,
    });
  } else {
    await enqueueNotification(eventId, "player_joined", {
      title: eventTitle,
      key: "notifyPlayerJoined",
      params: { name: userName },
      url,
      spotsLeft,
    });
  }

  // player_joined webhook with viaInvite:true (existing event type + flag)
  fireWebhooks(eventId, "player_joined", { playerName: userName, isActive: !bench, spotsLeft, viaInvite: true }).catch(() => {});

  return { status: "accepted", bench };
}

/**
 * Decline a pending invite. Removes the GameParticipant + Rsvp for this game,
 * keeps the PlayerInvite record (status=declined) and the EventPlayer shell.
 * Fires no webhook. Throws when the invite isn't for the caller or not pending.
 */
export async function declinePlayerInvite(opts: { token: string; userId: string; gameId: string }): Promise<{ status: "declined" }> {
  const { token, userId, gameId } = opts;

  await expirePendingInvites(gameId);

  const invite = await prisma.playerInvite.findUnique({ where: { token }, include: { eventPlayer: { select: { userId: true } } } });
  if (!invite || invite.gameId !== gameId) throw new Error("Invite not found.");
  if (invite.status !== "pending") throw new Error(invite.status === "expired" ? "This invite has expired." : "This invite is no longer pending.");
  if (invite.eventPlayer.userId !== userId) throw new Error("This invite is not for your account.");

  await prisma.$transaction(async (tx) => {
    await tx.playerInvite.update({
      where: { id: invite.id },
      data: { status: "declined", respondedAt: new Date() },
    });
    await tx.gameParticipant.deleteMany({ where: { gameId, eventPlayerId: invite.eventPlayerId } });
    await tx.rsvp.deleteMany({ where: { gameId, eventPlayerId: invite.eventPlayerId } });
  });

  return { status: "declined" };
}

/**
 * Retract a pending invite (owner or inviter). Silent — no webhook, no notify.
 * Throws when the caller is not the owner or the original inviter.
 */
export async function retractPlayerInvite(opts: { inviteId: string; userId: string; eventId: string }): Promise<{ status: "cancelled" }> {
  const { inviteId, userId, eventId } = opts;

  // Backward compat: pre-fix clients sent the EventPlayer id (invited[].id)
  // instead of the PlayerInvite id (invited[].inviteId). Fall back to lookup
  // by EventPlayer for the current game, mirroring resendPlayerInvite.
  let invite: { id: string; gameId: string; invitedByUserId: string; eventPlayerId: string } | null =
    await prisma.playerInvite.findUnique({
      where: { id: inviteId },
      select: { id: true, gameId: true, invitedByUserId: true, eventPlayerId: true },
    });
  if (!invite) {
    const eventForFallback = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
    if (eventForFallback?.currentGameId) {
      invite = (await prisma.playerInvite.findFirst({
        where: { eventPlayerId: inviteId, gameId: eventForFallback.currentGameId },
        select: { id: true, gameId: true, invitedByUserId: true, eventPlayerId: true },
      })) ?? null;
    }
  }
  if (!invite) throw new Error("Invite not found.");

  // Verify the invite belongs to this event via its game.
  const game = await prisma.game.findUnique({ where: { id: invite.gameId }, select: { eventId: true } });
  if (!game || game.eventId !== eventId) throw new Error("Invite not found.");

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { ownerId: true } });
  const isOwnerOrInviter = event?.ownerId === userId || invite.invitedByUserId === userId;
  if (!isOwnerOrInviter) {
    throw new Error("Only the owner or the inviter can retract an invite.");
  }

  // Cancel the pending invite and clear the roster ghost (pending GameParticipant
  // + Rsvp) that createPlayerInvite planted. Without this the invitee lingers in
  // pendingParticipants, still renders as "Invited" with a null inviteId, and a
  // second remove sends the EventPlayer id → "Invite not found."
  const res = await prisma.$transaction(async (tx) => {
    const cancelled = await tx.playerInvite.updateMany({
      where: { id: invite.id, status: "pending" },
      data: { status: "cancelled", respondedAt: new Date() },
    });
    if (cancelled.count === 0) return 0;
    await tx.gameParticipant.deleteMany({ where: { gameId: invite.gameId, eventPlayerId: invite.eventPlayerId, status: "pending" } });
    await tx.rsvp.deleteMany({ where: { gameId: invite.gameId, eventPlayerId: invite.eventPlayerId } });
    return cancelled.count;
  });
  if (res === 0) throw new Error("Invite not found or no longer pending.");

  return { status: "cancelled" };
}