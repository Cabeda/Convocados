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
