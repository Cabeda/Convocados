import { prisma } from "~/lib/db.server";
import { checkEventAdmin } from "~/lib/auth.helpers.server";
import type { getSession } from "~/lib/auth.helpers.server";
import { checkAccess } from "~/lib/eventAccess";

export type SeasonSession = Awaited<ReturnType<typeof getSession>>;

export const seasonEventSelect = {
  id: true,
  ownerId: true,
  accessPassword: true,
} as const;

export function isSeasonRegistrationOpen(season: {
  status: string;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
}, now = new Date()) {
  return season.status === "registration" && season.registrationOpensAt <= now && now < season.registrationClosesAt;
}

/**
 * UTC calendar day (`YYYY-MM-DD`) of a timestamp. Season coexistence compares
 * windows by day, not by time-of-day: back-to-back seasons sharing a boundary
 * day are adjacent, not overlapping.
 */
export function seasonDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type SeasonWindow = {
  registrationOpensAt: Date;
  registrationClosesAt: Date;
};

/**
 * Date-only, exclusive-edge window overlap. Cancelled seasons are excluded by
 * the caller. `a.closes == b.opens` (same day) is adjacency, not overlap.
 */
export function seasonWindowsOverlapByDay(a: SeasonWindow, b: SeasonWindow): boolean {
  const aOpen = seasonDayKey(a.registrationOpensAt);
  const aClose = seasonDayKey(a.registrationClosesAt);
  const bOpen = seasonDayKey(b.registrationOpensAt);
  const bClose = seasonDayKey(b.registrationClosesAt);
  return aOpen < bClose && bOpen < aClose;
}

/**
 * Derived display flag: this season's registration period is "now" (date-only,
 * half-open). `status` remains the lifecycle source of truth; `isCurrent` is
 * for display only. Cancelled seasons are never current.
 */
export function isSeasonCurrent(season: { status: string } & SeasonWindow, now = new Date()): boolean {
  if (season.status === "cancelled") return false;
  const today = seasonDayKey(now);
  return seasonDayKey(season.registrationOpensAt) <= today && today < seasonDayKey(season.registrationClosesAt);
}

/**
 * Attendance window for season recommendations and candidate stats: the
 * season period up to now. Future games have not been played yet, so they
 * never count toward attendance.
 */
export function seasonAttendanceWindow(season: {
  registrationOpensAt: Date;
  registrationClosesAt: Date;
}, now = new Date()): { gte: Date; lte: Date } {
  return {
    gte: season.registrationOpensAt,
    lte: season.registrationClosesAt < now ? season.registrationClosesAt : now,
  };
}

export async function getSeasonForEvent(seasonId: string, eventId: string) {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { event: { select: seasonEventSelect } },
  });
  if (!season || season.eventId !== eventId) return null;
  return season;
}

export async function authorizeSeasonRequest(
  season: Awaited<ReturnType<typeof getSeasonForEvent>>,
  session: SeasonSession,
  request: Request,
) {
  if (!season) return { allowed: false, isAdmin: false, isOwner: false };
  const userId = session?.user?.id ?? null;
  const isOwner = userId !== null && season.event.ownerId === userId;
  const isAdmin = userId ? await checkEventAdmin(season.event.id, userId) : false;
  const isInvited = userId
    ? (await prisma.eventInvite.count({ where: { eventId: season.event.id, userId } })) > 0
    : false;
  const allowed = checkAccess({
    eventOwnerId: season.event.ownerId,
    accessPassword: season.event.accessPassword,
    requestUserId: userId,
    cookieHeader: request.headers.get("cookie"),
    eventId: season.event.id,
    isInvited: isAdmin || isInvited,
  }).granted;
  return { allowed, isAdmin: isOwner || isAdmin, isOwner };
}

export async function requireSeasonAdmin(
  season: Awaited<ReturnType<typeof getSeasonForEvent>>,
  session: SeasonSession,
  request: Request,
) {
  const authz = await authorizeSeasonRequest(season, session, request);
  return { ...authz, isAdmin: authz.allowed && authz.isAdmin };
}
