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
import { createT, type Locale } from "./i18n";

const log = createLogger("invite");

export type PlayerInviteStatus = "pending" | "accepted" | "declined" | "expired" | "cancelled";

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
}): Promise<{ inviteId: string; token: string; inviteUrl: string }> {
  const { eventId, gameId, inviteeUserId, invitedByUserId, origin } = opts;
  const user = await prisma.user.findUnique({
    where: { id: inviteeUserId },
    select: { name: true },
  });
  if (!user) throw new Error("Invitee not found.");

  const ep = await prisma.eventPlayer.upsert({
    where: { eventId_name: { eventId, name: user.name } },
    create: { eventId, name: user.name, userId: inviteeUserId },
    update: { userId: inviteeUserId },
  });

  const token = generateInviteToken();
  const invite = await prisma.$transaction(async (tx) => {
    const inv = await tx.playerInvite.create({
      data: {
        gameId,
        eventPlayerId: ep.id,
        invitedByUserId,
        status: "pending",
        token,
        notifiedAt: new Date(),
      },
    });

    // ADR 0025: pending roster entry — visible to participants/owner as
    // "Invited", counts toward nothing (roster/bench/payments/teams).
    const order = await nextGameParticipantOrder(gameId);
    await tx.gameParticipant.create({
      data: { gameId, eventPlayerId: ep.id, order, status: "pending" },
    });

    return inv;
  });

  const inviteUrl = `${origin}/invite/${token}`;

  await notifyInvitee({ userId: inviteeUserId, eventId, inviteUrl, invitedByUserId });
  fireWebhooks(eventId, "player_invited", { playerName: user.name, inviteUrl }).catch(() => {});

  log.info({ inviteId: invite.id, eventId, inviteeUserId, invitedByUserId }, "Player invite created");
  return { inviteId: invite.id, token, inviteUrl };
}

async function notifyInvitee(opts: { userId: string; eventId: string; inviteUrl: string; invitedByUserId: string }) {
  const prefs = await getNotificationPrefs(opts.userId);
  if (!wantsInvites(prefs)) return;

  const [event, inviterToken] = await Promise.all([
    prisma.event.findUnique({ where: { id: opts.eventId }, select: { title: true } }),
    // The inviter's push locale (AppPushToken) — the push is composed by them.
    prisma.appPushToken.findFirst({ where: { userId: opts.invitedByUserId }, select: { locale: true } }),
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

  if (prefs.pushEnabled) {
    // Push body is composed by the inviter — render it in the INVITER's locale.
    const inviterLocale = (inviterToken?.locale as Locale) ?? "en";
    const t = createT(inviterLocale);
    sendPushToUser(opts.userId, title, t(key, { event: title }), opts.inviteUrl).catch(() => {});
  }
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

  const invite = await prisma.playerInvite.findUnique({
    where: { id: inviteId },
    select: { invitedByUserId: true, eventPlayer: { select: { eventId: true } } },
  });
  if (!invite || invite.eventPlayer.eventId !== eventId) {
    throw new Error("Invite not found.");
  }

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { ownerId: true } });
  const isOwnerOrInviter = event?.ownerId === userId || invite.invitedByUserId === userId;
  if (!isOwnerOrInviter) {
    throw new Error("Only the owner or the inviter can retract an invite.");
  }

  const res = await prisma.playerInvite.updateMany({
    where: { id: inviteId, status: "pending" },
    data: { status: "cancelled", respondedAt: new Date() },
  });
  if (res.count === 0) throw new Error("Invite not found or no longer pending.");

  return { status: "cancelled" };
}