/** #457 RSVP + smart push prompt state machine. */

import { prisma } from "./db.server";
import { createLogger } from "./logger.server";
import type { RsvpStatus, RsvpStatusValue } from "./rsvp";

const log = createLogger("rsvp");

// ─── Constants ─────────────────────────────────────────────────────────────

/** 14 days. Re-prompt floor after an in-app banner dismissal.
 *  Was 30d in v1 (#457); tightened to 14d after push-conversion data showed the
 *  30-day gap let the dismissed cohort drift out of the habit before re-prompt. */
export const PUSH_PROMPT_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

/** 7 days. Accounts younger than this skip the cooldown gate entirely on first
 *  high-intent surface — fresh users are most receptive to enabling push. */
export const FRESH_ACCOUNT_DAYS = 7;

/** Rolling 7-day window for the "engagement accelerator" rule. */
export const APP_OPEN_LOOKBACK_DAYS = 7;

/** ≥3 distinct app-open days within the lookback window unlocks the accelerator. */
export const APP_OPEN_THRESHOLD = 3;

/** 48 hours — match the priority-default cadence from the spec. */
export const RSVP_WINDOW_HOURS = 48;

/** 24 hours — organizer summary push cadence. */
export const RSVP_SUMMARY_HOURS = 24;

/** Allowed push prompt states. */
export type PushPromptState = "default" | "granted" | "dismissed" | "denied";

// ─── RSVP upsert + read ────────────────────────────────────────────────────

/** Resolve the EventPlayer for a linked user on an event. Creates one if missing (lazy). */
export async function resolveEventPlayerId(eventId: string, userId: string): Promise<string> {
  // Try finding by userId first
  let ep = await prisma.eventPlayer.findFirst({
    where: { eventId, userId },
    select: { id: true },
  });
  if (ep) return ep.id;
  // Fallback: find a Player row with this userId, match by name
  const player = await prisma.player.findFirst({
    where: { eventId, userId, archivedAt: null },
    select: { name: true },
  });
  if (player) {
    const created = await prisma.eventPlayer.upsert({
      where: { eventId_name: { eventId, name: player.name } },
      create: { eventId, name: player.name, userId },
      update: { userId },
    });
    return created.id;
  }
  // Last resort: find by user's display name
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!user) throw new Error("User not found.");
  const created = await prisma.eventPlayer.upsert({
    where: { eventId_name: { eventId, name: user.name } },
    create: { eventId, name: user.name, userId },
    update: { userId },
  });
  return created.id;
}

/** Idempotent RSVP upsert for a linked user. Resolves EventPlayer + currentGameId internally. */
export async function upsertRsvp(eventId: string, userId: string, status: RsvpStatusValue) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
  if (!event?.currentGameId) throw new Error("Event has no active game.");
  const eventPlayerId = await resolveEventPlayerId(eventId, userId);
  return prisma.rsvp.upsert({
    where: { eventPlayerId_gameId: { eventPlayerId, gameId: event.currentGameId } },
    create: { eventPlayerId, gameId: event.currentGameId, status, respondedAt: new Date() },
    update: { status, respondedAt: new Date() },
  });
}

/** Upsert RSVP when you already have the eventPlayerId and gameId (avoids extra lookups). */
export async function upsertRsvpDirect(eventPlayerId: string, gameId: string, status: RsvpStatusValue | null, respondedByUserId?: string) {
  const respondedAt = status === null ? null : new Date();
  return prisma.rsvp.upsert({
    where: { eventPlayerId_gameId: { eventPlayerId, gameId } },
    create: { eventPlayerId, gameId, status, respondedAt, respondedByUserId },
    update: { status, respondedAt, ...(respondedByUserId ? { respondedByUserId } : {}) },
  });
}

export async function getRsvpForUser(eventId: string, userId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
  if (!event?.currentGameId) return null;
  const ep = await prisma.eventPlayer.findFirst({ where: { eventId, userId }, select: { id: true } });
  if (!ep) return null;
  return prisma.rsvp.findUnique({
    where: { eventPlayerId_gameId: { eventPlayerId: ep.id, gameId: event.currentGameId } },
  });
}

/** Idempotent RSVP upsert for a guest Player. Admin/owner acts on the guest's behalf. */
export async function upsertGuestRsvp(
  eventId: string,
  playerId: string,
  status: RsvpStatus,
  actorUserId: string,
) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { eventId: true, userId: true, name: true },
  });
  if (!player) throw new Error("Player not found.");
  if (player.eventId !== eventId) throw new Error("Player does not belong to this event.");
  if (player.userId) throw new Error("Player is linked to a User — that user must self-RSVP.");

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
  if (!event?.currentGameId) throw new Error("Event has no active game.");

  const ep = await prisma.eventPlayer.upsert({
    where: { eventId_name: { eventId, name: player.name } },
    create: { eventId, name: player.name },
    update: {},
  });

  const respondedAt = status === null ? null : new Date();
  return prisma.rsvp.upsert({
    where: { eventPlayerId_gameId: { eventPlayerId: ep.id, gameId: event.currentGameId } },
    create: { eventPlayerId: ep.id, gameId: event.currentGameId, status, respondedAt, respondedByUserId: actorUserId },
    update: { status, respondedAt, respondedByUserId: actorUserId },
  });
}

export async function getRsvpForGuest(eventId: string, playerId: string) {
  const player = await prisma.player.findUnique({ where: { id: playerId }, select: { name: true } });
  if (!player) return null;
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
  if (!event?.currentGameId) return null;
  const ep = await prisma.eventPlayer.findFirst({ where: { eventId, name: player.name }, select: { id: true } });
  if (!ep) return null;
  return prisma.rsvp.findUnique({
    where: { eventPlayerId_gameId: { eventPlayerId: ep.id, gameId: event.currentGameId } },
  });
}

/** Map of playerId → RSVP status for all active guest Players in the current game. */
export async function getGuestRsvpMap(eventId: string): Promise<Record<string, RsvpStatus>> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
  if (!event?.currentGameId) return {};

  const guests = await prisma.player.findMany({
    where: { eventId, userId: null, archivedAt: null },
    select: { id: true, name: true },
  });
  if (guests.length === 0) return {};

  // Resolve EventPlayer IDs for these guests
  const eventPlayers = await prisma.eventPlayer.findMany({
    where: { eventId, name: { in: guests.map((g) => g.name) } },
    select: { id: true, name: true },
  });
  const epByName = new Map(eventPlayers.map((ep) => [ep.name, ep.id]));

  const epIds = eventPlayers.map((ep) => ep.id);
  const rsvps = await prisma.rsvp.findMany({
    where: { gameId: event.currentGameId, eventPlayerId: { in: epIds } },
    select: { eventPlayerId: true, status: true },
  });
  const rsvpByEpId = new Map(rsvps.map((r) => [r.eventPlayerId, r.status as RsvpStatus]));

  // Map back to playerId for the UI (PlayerList renders by playerId)
  const map: Record<string, RsvpStatus> = {};
  for (const g of guests) {
    const epId = epByName.get(g.name);
    map[g.id] = epId ? (rsvpByEpId.get(epId) ?? null) : null;
  }
  return map;
}

/** Map of userId → RSVP status for linked Users in the current game. */
export async function getUserRsvpMap(eventId: string, viewerIsLogged: boolean): Promise<Record<string, RsvpStatus>> {
  if (!viewerIsLogged) return {};
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
  if (!event?.currentGameId) return {};

  // Get all EventPlayers with a userId for this event
  const eventPlayers = await prisma.eventPlayer.findMany({
    where: { eventId, userId: { not: null } },
    select: { id: true, userId: true },
  });
  if (eventPlayers.length === 0) return {};

  const epIds = eventPlayers.map((ep) => ep.id);
  const rsvps = await prisma.rsvp.findMany({
    where: { gameId: event.currentGameId, eventPlayerId: { in: epIds } },
    select: { eventPlayerId: true, status: true },
  });
  const rsvpByEpId = new Map(rsvps.map((r) => [r.eventPlayerId, r.status as RsvpStatus]));

  // Map back to userId for the UI
  const map: Record<string, RsvpStatus> = {};
  for (const ep of eventPlayers) {
    if (ep.userId && rsvpByEpId.has(ep.id)) {
      map[ep.userId] = rsvpByEpId.get(ep.id) ?? null;
    }
  }
  return map;
}

export interface RsvpSummary {
  yes: number;
  no: number;
  pending: number;
  yesUserIds: string[];
  noUserIds: string[];
  pendingUserIds: string[];
}

/** User-recipient set: EventFollow ∪ active Player.userId ∪ Owner. Unlinked guests excluded (they have their own Rsvp keyed on playerId). Archived linked players excluded — see #XXX off-by-one fix. */
export async function getRsvpRecipients(eventId: string): Promise<string[]> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      ownerId: true,
      followers: { select: { userId: true } },
      players: { where: { archivedAt: null }, select: { userId: true } },
    },
  });
  if (!event) return [];
  const set = new Set<string>();
  if (event.ownerId) set.add(event.ownerId);
  for (const f of event.followers) if (f.userId) set.add(f.userId);
  for (const p of event.players) if (p.userId) set.add(p.userId);
  return [...set];
}

/** Guest-recipient set: active Player rows with userId IS NULL. */
async function getActiveGuestPlayers(eventId: string): Promise<{ id: string }[]> {
  return prisma.player.findMany({
    where: { eventId, userId: null, archivedAt: null },
    select: { id: true },
  });
}

export async function getRsvpSummary(eventId: string): Promise<RsvpSummary> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
  if (!event?.currentGameId) return { yes: 0, no: 0, pending: 0, yesUserIds: [], noUserIds: [], pendingUserIds: [] };

  const recipientIds = await getRsvpRecipients(eventId);
  const guestPlayers = await getActiveGuestPlayers(eventId);

  // Resolve EventPlayer IDs for recipients (linked users)
  const linkedEps = await prisma.eventPlayer.findMany({
    where: { eventId, userId: { in: recipientIds } },
    select: { id: true, userId: true },
  });
  // Resolve EventPlayer IDs for guests
  const guestNames = await prisma.player.findMany({
    where: { id: { in: guestPlayers.map((g) => g.id) } },
    select: { id: true, name: true },
  });
  const guestEps = await prisma.eventPlayer.findMany({
    where: { eventId, name: { in: guestNames.map((g) => g.name) } },
    select: { id: true, name: true },
  });

  const allEpIds = [...linkedEps.map((e) => e.id), ...guestEps.map((e) => e.id)];
  const rsvps = await prisma.rsvp.findMany({
    where: { gameId: event.currentGameId, eventPlayerId: { in: allEpIds } },
    select: { eventPlayerId: true, status: true },
  });
  const rsvpByEpId = new Map(rsvps.map((r) => [r.eventPlayerId, r.status]));

  // Map linked user RSVPs back to userId
  const yesUserIds: string[] = [];
  const noUserIds: string[] = [];
  const pendingUserIds: string[] = [];
  for (const uid of recipientIds) {
    const ep = linkedEps.find((e) => e.userId === uid);
    const s = ep ? rsvpByEpId.get(ep.id) : undefined;
    if (s === "yes") yesUserIds.push(uid);
    else if (s === "no") noUserIds.push(uid);
    else pendingUserIds.push(uid);
  }

  // Map guest RSVPs
  const guestEpByName = new Map(guestEps.map((e) => [e.name, e.id]));
  let yesGuestCount = 0;
  let noGuestCount = 0;
  let pendingGuestCount = 0;
  for (const gn of guestNames) {
    const epId = guestEpByName.get(gn.name);
    const s = epId ? rsvpByEpId.get(epId) : undefined;
    if (s === "yes") yesGuestCount++;
    else if (s === "no") noGuestCount++;
    else pendingGuestCount++;
  }

  return {
    yes: yesUserIds.length + yesGuestCount,
    no: noUserIds.length + noGuestCount,
    pending: pendingUserIds.length + pendingGuestCount,
    yesUserIds,
    noUserIds,
    pendingUserIds,
  };
}

// ─── 48h fanout ────────────────────────────────────────────────────────────

/** Events whose (dateTime - 48h) is in the next 1h window — the 48h tick. */
export async function getEventsNeedingRsvpPing(now: Date = new Date()) {
  const windowStart = new Date(now.getTime() + (RSVP_WINDOW_HOURS - 1) * 3600_000);
  const windowEnd = new Date(now.getTime() + (RSVP_WINDOW_HOURS + 1) * 3600_000);
  return prisma.event.findMany({
    where: {
      rsvpCutoffSent: false,
      dateTime: { gte: windowStart, lte: windowEnd },
    },
    select: { id: true, title: true, dateTime: true, location: true, ownerId: true },
  });
}

/** Events whose (dateTime - 24h) is in the next 1h window — organizer summary tick. */
export async function getEventsNeedingRsvpSummary(now: Date = new Date()) {
  const windowStart = new Date(now.getTime() + (RSVP_SUMMARY_HOURS - 1) * 3600_000);
  const windowEnd = new Date(now.getTime() + (RSVP_SUMMARY_HOURS + 1) * 3600_000);
  return prisma.event.findMany({
    where: {
      dateTime: { gte: windowStart, lte: windowEnd },
      rsvpCutoffSent: true, // only after the 48h fanout actually fired
    },
    select: { id: true, title: true, dateTime: true, location: true, ownerId: true },
  });
}

export async function markRsvpCutoffSent(eventId: string) {
  await prisma.event.update({
    where: { id: eventId },
    data: { rsvpCutoffSent: true },
  });
  log.info({ eventId }, "RSVP 48h cutoff marked sent");
}

// ─── Recruitment dedup (#538 follow-up) ────────────────────────────────────
//
// Bug: recruitment notifications were enqueued on every cron run within the
// T-48h / T-24h 2-hour window — flooding every non-playing follower ~24 times
// per window. These flags ensure each recruitment ping fires exactly once
// per occurrence, and are reset whenever the event advances to its next
// occurrence (lazy reset, explicit recurrence reset, or cancel-then-advance).

/** Events needing the T-48h recruitment ping (still needs players). */
export async function getEventsNeedingRecruitment48h(now: Date = new Date()) {
  const windowStart = new Date(now.getTime() + (RSVP_WINDOW_HOURS - 1) * 3600_000);
  const windowEnd = new Date(now.getTime() + (RSVP_WINDOW_HOURS + 1) * 3600_000);
  return prisma.event.findMany({
    where: {
      rsvpCutoffSent: true, // precondition: T-48h fanout has already fired
      recruitment48hSent: false,
      dateTime: { gte: windowStart, lte: windowEnd },
    },
    select: { id: true, title: true, maxPlayers: true, recruitmentThreshold: true },
  });
}

/** Events needing the T-24h urgent recruitment ping (tomorrow — still needs players). */
export async function getEventsNeedingRecruitment24h(now: Date = new Date()) {
  const windowStart = new Date(now.getTime() + (RSVP_SUMMARY_HOURS - 1) * 3600_000);
  const windowEnd = new Date(now.getTime() + (RSVP_SUMMARY_HOURS + 1) * 3600_000);
  return prisma.event.findMany({
    where: {
      rsvpCutoffSent: true,
      recruitment24hSent: false,
      dateTime: { gte: windowStart, lte: windowEnd },
    },
    select: { id: true, title: true, maxPlayers: true, recruitmentThreshold: true, ownerId: true },
  });
}

export async function markRecruitment48hSent(eventId: string) {
  await prisma.event.update({
    where: { id: eventId },
    data: { recruitment48hSent: true },
  });
}

export async function markRecruitment24hSent(eventId: string) {
  await prisma.event.update({
    where: { id: eventId },
    data: { recruitment24hSent: true },
  });
}

/**
 * Reset all recruitment dedup flags — called when an event advances to its
 * next occurrence so the next occurrence gets a fresh recruitment cycle.
 */
export async function resetRecruitmentFlags(eventId: string) {
  await prisma.event.update({
    where: { id: eventId },
    data: {
      recruitment48hSent: false,
      recruitment24hSent: false,
    },
  });
}

export async function isRsvpCutoffSent(eventId: string) {
  const e = await prisma.event.findUnique({
    where: { id: eventId },
    select: { rsvpCutoffSent: true },
  });
  return e?.rsvpCutoffSent ?? false;
}

// ─── App-open heartbeat ────────────────────────────────────────────────────

/** Record a heartbeat for (userId, day=truncated UTC date). Idempotent per day. */
export async function recordAppOpen(userId: string, at: Date = new Date()) {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  await prisma.userAppOpen.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day },
    update: {},
  });
}

/** Distinct app-open days for the user within the last `lookbackDays` days (UTC). */
export async function countAppOpenDays(userId: string, lookbackDays: number = APP_OPEN_LOOKBACK_DAYS, now: Date = new Date()) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - lookbackDays + 1));
  return prisma.userAppOpen.count({
    where: { userId, day: { gte: since } },
  });
}

/** Does the user have at least one pending RSVP (status=null) for a future game? */
export async function userHasPendingRsvp(userId: string, now: Date = new Date()): Promise<boolean> {
  // Find EventPlayers for this user, then check if any have a pending RSVP on a future game
  const eps = await prisma.eventPlayer.findMany({
    where: { userId },
    select: { id: true },
  });
  if (eps.length === 0) return false;
  const row = await prisma.rsvp.findFirst({
    where: { eventPlayerId: { in: eps.map((e) => e.id) }, status: null, game: { dateTime: { gt: now } } },
    select: { id: true },
  });
  return !!row;
}

/** Number of whole days since the user account was created (UTC, fractional). */
export async function userAccountAgeDays(userId: string, now: Date = new Date()): Promise<number> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  });
  if (!u) return Number.POSITIVE_INFINITY;
  const ms = now.getTime() - u.createdAt.getTime();
  return ms / (24 * 60 * 60 * 1000);
}

// ─── Push prompt state ─────────────────────────────────────────────────────

export async function getPushPromptState(userId: string): Promise<PushPromptState> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { pushPromptState: true },
  });
  return (u?.pushPromptState as PushPromptState) ?? "default";
}

export async function setPushPromptState(userId: string, state: PushPromptState) {
  const data: Record<string, unknown> = { pushPromptState: state };
  if (state === "dismissed") data.pushPromptLastDismissedAt = new Date();
  await prisma.user.update({ where: { id: userId }, data });
}

/**
 * Should the soft banner appear for this user on this page render?
 * - granted / denied → never (granted = no banner; denied = show "blocked" hint instead, separate branch).
 * - dismissed + <14d → false (cooldown).
 * - dismissed + ≥14d → true.
 * - default → true (subject to the 14d cooldown on future dismissals).
 * - Accelerator: dismissed + ≥3 app-open days in last 7d + has pending RSVP → true regardless of cooldown.
 * - Fresh account: account age ≤ FRESH_ACCOUNT_DAYS → true even within cooldown
 *   (first-7d onboarding — skip the gate for new signups).
 */
export async function shouldShowPushPrompt(
  userId: string,
  hasPendingRsvp: boolean,
  now: Date = new Date(),
): Promise<boolean> {
  const state = await getPushPromptState(userId);
  if (state === "granted" || state === "denied") return false;

  // Fresh account bypass — applies to dismissed AND default states.
  const ageDays = await userAccountAgeDays(userId, now);
  if (ageDays <= FRESH_ACCOUNT_DAYS) return true;

  if (state === "dismissed") {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { pushPromptLastDismissedAt: true },
    });
    const lastDismiss = u?.pushPromptLastDismissedAt?.getTime() ?? 0;
    const pastCooldown = now.getTime() - lastDismiss >= PUSH_PROMPT_COOLDOWN_MS;
    if (pastCooldown) return true;

    // Accelerator
    if (hasPendingRsvp) {
      const days = await countAppOpenDays(userId, APP_OPEN_LOOKBACK_DAYS, now);
      if (days >= APP_OPEN_THRESHOLD) return true;
    }
    return false;
  }

  // default → show
  return true;
}
