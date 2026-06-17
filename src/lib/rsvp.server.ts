/** #457 RSVP + smart push prompt state machine. */

import { prisma } from "./db.server";
import { createLogger } from "./logger.server";

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

/** Idempotent RSVP upsert. status ∈ {"yes", "no"} — null is "pending" and represented as a missing row. */
export async function upsertRsvp(eventId: string, userId: string, status: "yes" | "no") {
  return prisma.rsvp.upsert({
    where: { userId_eventId: { userId, eventId } },
    create: { eventId, userId, status, respondedAt: new Date() },
    update: { status, respondedAt: new Date() },
  });
}

export async function getRsvpForUser(eventId: string, userId: string) {
  return prisma.rsvp.findUnique({
    where: { userId_eventId: { userId, eventId } },
  });
}

export interface RsvpSummary {
  yes: number;
  no: number;
  pending: number;
  yesUserIds: string[];
  noUserIds: string[];
  pendingUserIds: string[];
}

/** Counted across: EventFollow ∪ Player.userId ∪ Owner. Unlinked guests excluded. */
export async function getRsvpRecipients(eventId: string): Promise<string[]> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      ownerId: true,
      followers: { select: { userId: true } },
      players: { select: { userId: true } },
    },
  });
  if (!event) return [];
  const set = new Set<string>();
  if (event.ownerId) set.add(event.ownerId);
  for (const f of event.followers) if (f.userId) set.add(f.userId);
  for (const p of event.players) if (p.userId) set.add(p.userId);
  return [...set];
}

export async function getRsvpSummary(eventId: string): Promise<RsvpSummary> {
  const recipientIds = await getRsvpRecipients(eventId);
  const rsvps = await prisma.rsvp.findMany({
    where: { eventId, userId: { in: recipientIds } },
    select: { userId: true, status: true },
  });

  const responded = new Map<string, "yes" | "no">();
  for (const r of rsvps) {
    if (r.status === "yes" || r.status === "no") responded.set(r.userId, r.status);
  }

  const yes: string[] = [];
  const no: string[] = [];
  const pending: string[] = [];
  for (const uid of recipientIds) {
    const s = responded.get(uid);
    if (s === "yes") yes.push(uid);
    else if (s === "no") no.push(uid);
    else pending.push(uid);
  }
  return { yes: yes.length, no: no.length, pending: pending.length, yesUserIds: yes, noUserIds: no, pendingUserIds: pending };
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

/** Does the user have at least one pending RSVP (status=null) for a future event? */
export async function userHasPendingRsvp(userId: string, now: Date = new Date()): Promise<boolean> {
  const row = await prisma.rsvp.findFirst({
    where: { userId, status: null, event: { dateTime: { gt: now } } },
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
