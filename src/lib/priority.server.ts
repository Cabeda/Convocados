/** Priority enrollment server helpers — DB operations */

import { prisma } from "./db.server";
import { createLogger } from "./logger.server";

const log = createLogger("priority");

export interface PrioritySettingsData {
  priorityEnabled: boolean;
  priorityThreshold: number;
  priorityWindow: number;
  priorityMaxPercent: number;
  priorityDeadlineHours: number;
  priorityMinGames: number;
}

/** Get priority settings for an event */
export async function getPrioritySettings(eventId: string): Promise<PrioritySettingsData | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      priorityEnabled: true,
      priorityThreshold: true,
      priorityWindow: true,
      priorityMaxPercent: true,
      priorityDeadlineHours: true,
      priorityMinGames: true,
    },
  });
  return event;
}

/** Update priority settings for an event */
export async function updatePrioritySettings(eventId: string, data: Partial<PrioritySettingsData>) {
  return prisma.event.update({ where: { id: eventId }, data });
}

/** Get all priority enrollments for an event */
export async function getEnrollments(eventId: string) {
  return prisma.priorityEnrollment.findMany({
    where: { eventId },
    include: { user: { select: { id: true, name: true, email: true, createdAt: true } } },
  });
}

/** Add a priority enrollment (manual or auto) */
export async function addEnrollment(eventId: string, userId: string, source: "auto" | "manual" = "auto") {
  return prisma.priorityEnrollment.upsert({
    where: { eventId_userId: { eventId, userId } },
    create: { eventId, userId, source, optedIn: true },
    update: { source, optedIn: true, declineStreak: 0, noShowStreak: 0 },
  });
}

/** Remove a priority enrollment */
export async function removeEnrollment(eventId: string, userId: string) {
  return prisma.priorityEnrollment.deleteMany({ where: { eventId, userId } });
}

/** Player opts out of priority enrollment */
export async function optOut(eventId: string, userId: string) {
  return prisma.priorityEnrollment.updateMany({
    where: { eventId, userId },
    data: { optedIn: false },
  });
}

/** Player opts back in */
export async function optIn(eventId: string, userId: string) {
  return prisma.priorityEnrollment.updateMany({
    where: { eventId, userId },
    data: { optedIn: true, declineStreak: 0 },
  });
}

/** Create pending confirmations for auto-enrolled players */
export async function createConfirmations(
  eventId: string,
  userIds: string[],
  gameDate: Date,
  deadline: Date,
) {
  const now = new Date();
  const data = userIds.map((userId) => ({
    eventId,
    userId,
    gameDate,
    status: "pending",
    notifiedAt: now,
    deadline,
  }));

  // Upsert each confirmation individually to handle duplicates
  let count = 0;
  for (const d of data) {
    try {
      await prisma.priorityConfirmation.upsert({
        where: {
          eventId_userId_gameDate: { eventId: d.eventId, userId: d.userId, gameDate: d.gameDate },
        },
        create: d,
        update: {}, // no-op if already exists
      });
      count++;
    } catch {
      // Skip on conflict
    }
  }
  log.info({ eventId, count }, "Created priority confirmations");
  return { count };
}

/** Player confirms their spot */
export async function confirmSpot(eventId: string, userId: string, gameDate: Date) {
  const confirmation = await prisma.priorityConfirmation.findUnique({
    where: { eventId_userId_gameDate: { eventId, userId, gameDate } },
  });
  if (!confirmation) return null;
  if (confirmation.status !== "pending") return confirmation;

  const updated = await prisma.priorityConfirmation.update({
    where: { id: confirmation.id },
    data: { status: "confirmed", respondedAt: new Date() },
  });

  // Reset decline streak on confirm
  await prisma.priorityEnrollment.updateMany({
    where: { eventId, userId },
    data: { declineStreak: 0 },
  });

  return updated;
}

/** Player declines their spot */
export async function declineSpot(eventId: string, userId: string, gameDate: Date) {
  const confirmation = await prisma.priorityConfirmation.findUnique({
    where: { eventId_userId_gameDate: { eventId, userId, gameDate } },
  });
  if (!confirmation) return null;
  if (confirmation.status !== "pending") return confirmation;

  const updated = await prisma.priorityConfirmation.update({
    where: { id: confirmation.id },
    data: { status: "declined", respondedAt: new Date() },
  });

  // Increment decline streak
  await prisma.priorityEnrollment.updateMany({
    where: { eventId, userId },
    data: { declineStreak: { increment: 1 } },
  });

  return updated;
}

/** Expire unconfirmed spots past deadline */
export async function expireUnconfirmed() {
  const now = new Date();
  const expired = await prisma.priorityConfirmation.updateMany({
    where: { status: "pending", deadline: { lte: now } },
    data: { status: "expired" },
  });
  if (expired.count > 0) {
    log.info({ count: expired.count }, "Expired unconfirmed priority spots");
  }
  return expired.count;
}

/** Get pending confirmations for a specific event and game date */
export async function getPendingConfirmations(eventId: string, gameDate: Date) {
  return prisma.priorityConfirmation.findMany({
    where: { eventId, gameDate, status: "pending" },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
}

/** Get all confirmations for an event and game date */
export async function getConfirmations(eventId: string, gameDate: Date) {
  return prisma.priorityConfirmation.findMany({
    where: { eventId, gameDate },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/** Get a user's confirmation for a specific event */
export async function getUserConfirmation(eventId: string, userId: string, gameDate: Date) {
  return prisma.priorityConfirmation.findUnique({
    where: { eventId_userId_gameDate: { eventId, userId, gameDate } },
  });
}

/** Record a no-show: increment noShowStreak on enrollment */
export async function recordNoShow(eventId: string, userId: string) {
  await prisma.priorityEnrollment.updateMany({
    where: { eventId, userId },
    data: { noShowStreak: { increment: 1 } },
  });
}

/** Reset no-show streak (when player actually shows up) */
export async function resetNoShowStreak(eventId: string, userId: string) {
  await prisma.priorityEnrollment.updateMany({
    where: { eventId, userId },
    data: { noShowStreak: 0 },
  });
}

/**
 * Auto-enroll priority players after a recurrence reset.
 * Called non-blocking from the recurrence reset logic.
 *
 * 1. Fetch event settings + history + enrollments
 * 2. Calculate eligibility
 * 3. Rank and cap
 * 4. Create pending confirmations
 * 5. Add confirmed players to the event player list
 */
export async function autoPriorityEnroll(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true, maxPlayers: true, dateTime: true,
      priorityEnabled: true, priorityThreshold: true, priorityWindow: true,
      priorityMaxPercent: true, priorityDeadlineHours: true, priorityMinGames: true,
    },
  });
  if (!event || !event.priorityEnabled) return;

  // Lazy import to avoid circular deps
  const { calculateEligibility, rankAndCap, confirmationDeadline } = await import("./priority");
  const { calculateAttendance } = await import("./attendance");

  const history = await prisma.gameHistory.findMany({
    where: { eventId },
    orderBy: { dateTime: "asc" },
  });

  const enrollments = await prisma.priorityEnrollment.findMany({
    where: { eventId },
    include: { user: { select: { id: true, name: true, email: true, createdAt: true } } },
  });

  if (enrollments.length === 0) return;

  const players = enrollments.map((e) => ({
    userId: e.userId,
    name: e.user.name,
    optedIn: e.optedIn,
    declineStreak: e.declineStreak,
    noShowStreak: e.noShowStreak,
    accountCreatedAt: e.user.createdAt,
  }));

  const settings = {
    threshold: event.priorityThreshold,
    window: event.priorityWindow,
    minGames: event.priorityMinGames,
    maxPercent: event.priorityMaxPercent,
  };

  const eligibility = calculateEligibility(history, players, settings);
  const ranked = rankAndCap(eligibility.eligible, event.maxPlayers, event.priorityMaxPercent);

  if (ranked.length === 0) return;

  const deadline = confirmationDeadline(event.dateTime, event.priorityDeadlineHours);
  const userIds = ranked.map((c) => c.userId);

  await createConfirmations(eventId, userIds, event.dateTime, deadline);

  log.info({ eventId, count: ranked.length, deadline: deadline.toISOString() }, "Auto-enrolled priority players");
}
