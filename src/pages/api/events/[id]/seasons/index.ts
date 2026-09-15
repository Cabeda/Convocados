import type { APIRoute } from "astro";
import { prisma, Prisma } from "~/lib/db.server";
import { getSession, checkEventAdmin } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { checkAccess } from "~/lib/eventAccess";
import { isSeasonCurrent, seasonWindowsOverlapByDay } from "~/lib/seasonSetup.server";

const TERMINAL_STATUSES = ["completed", "cancelled"];

type Session = Awaited<ReturnType<typeof getSession>>;

type SeasonWithDates = {
  id: string;
  eventId: string;
  name: string;
  status: string;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  activatedAt: Date | null;
  reviewStartedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  ruleVersion: string;
  createdAt: Date;
};

function seasonResponse(
  season: SeasonWithDates,
  memberCount: number,
  currentMembership: { status: string; joinedAt: Date; withdrawnAt: Date | null } | null,
) {
  return {
    id: season.id,
    eventId: season.eventId,
    name: season.name,
    status: season.status,
    registrationOpensAt: season.registrationOpensAt,
    registrationClosesAt: season.registrationClosesAt,
    activatedAt: season.activatedAt,
    reviewStartedAt: season.reviewStartedAt,
    completedAt: season.completedAt,
    cancelledAt: season.cancelledAt,
    cancellationReason: season.cancellationReason,
    ruleVersion: season.ruleVersion,
    createdAt: season.createdAt,
    isCurrent: isSeasonCurrent(season),
    memberCount,
    currentMembership,
  };
}

async function eventAccessAllowed(
  event: { id: string; ownerId: string | null; accessPassword: string | null },
  session: Session,
  request: Request,
): Promise<boolean> {
  const userId = session?.user?.id ?? null;
  const isAdmin = userId ? await checkEventAdmin(event.id, userId) : false;
  const isInvited = userId
    ? (await prisma.eventInvite.count({ where: { eventId: event.id, userId } })) > 0
    : false;

  return checkAccess({
    eventOwnerId: event.ownerId,
    accessPassword: event.accessPassword,
    requestUserId: userId,
    cookieHeader: request.headers.get("cookie"),
    eventId: event.id,
    isInvited: isAdmin || isInvited,
  }).granted;
}

export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, ownerId: true, accessPassword: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!(await eventAccessAllowed(event, session, request))) {
    return Response.json({ locked: true, id: event.id, hasPassword: true }, { status: 200 });
  }

  const seasons = await prisma.season.findMany({
    where: { eventId },
    orderBy: { createdAt: "asc" },
  });
  const userId = session?.user?.id;
  const canManage = userId
    ? (event.ownerId === userId || await checkEventAdmin(event.id, userId))
    : false;
  const result = await Promise.all(seasons.map(async (season) => {
    const [memberCount, currentMembership] = await Promise.all([
      prisma.seasonMembership.count({ where: { seasonId: season.id, status: "active" } }),
      userId
        ? prisma.seasonMembership.findUnique({
            where: { seasonId_userId: { seasonId: season.id, userId } },
            select: { status: true, joinedAt: true, withdrawnAt: true },
          })
        : Promise.resolve(null),
    ]);
    return seasonResponse(season, memberCount, currentMembership);
  }));

  return Response.json({ seasons: result, canManage });
};

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, ownerId: true, eloEnabled: true, balanced: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const isOwner = event.ownerId === session.user.id;
  const isAdmin = !isOwner && await checkEventAdmin(eventId, session.user.id);
  if (!isOwner && !isAdmin) {
    return Response.json({ error: "Only the owner or an event admin can create a Season." }, { status: 403 });
  }
  if (!event.eloEnabled || !event.balanced) {
    return Response.json({ error: "Season registration requires ELO and balanced teams." }, { status: 409 });
  }

  let body: { name?: unknown; registrationOpensAt?: unknown; registrationClosesAt?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const opensAt = typeof body.registrationOpensAt === "string" ? new Date(body.registrationOpensAt) : null;
  const closesAt = typeof body.registrationClosesAt === "string" ? new Date(body.registrationClosesAt) : null;
  if (!name || name.length > 100 || !opensAt || !closesAt || Number.isNaN(opensAt.valueOf()) || Number.isNaN(closesAt.valueOf())) {
    return Response.json({ error: "name, registrationOpensAt and registrationClosesAt are required." }, { status: 400 });
  }
  if (closesAt <= opensAt) {
    return Response.json({ error: "Registration must close after it opens." }, { status: 400 });
  }

  // A Season occupies its registration window (compared by calendar day,
  // exclusive edges: sharing a boundary day is adjacency, not overlap).
  // Coexistence: an event may hold an active/review Season plus past/future
  // registration Seasons, as long as no two non-cancelled windows overlap.
  // Cancelled Seasons are abandoned and free their window for reuse.
  const others = await prisma.season.findMany({
    where: { eventId, status: { not: "cancelled" } },
    select: { name: true, status: true, registrationOpensAt: true, registrationClosesAt: true },
  });
  const clash = others.find((season) =>
    seasonWindowsOverlapByDay(
      { registrationOpensAt: opensAt, registrationClosesAt: closesAt },
      season,
    ),
  );
  if (clash) {
    if (!TERMINAL_STATUSES.includes(clash.status)) {
      return Response.json({ error: `This event already has an open Season ("${clash.name}", ${clash.status}). Complete or cancel it, or choose a non-overlapping period.` }, { status: 409 });
    }
    return Response.json({ error: "This Season's period overlaps an existing Season." }, { status: 409 });
  }

  try {
    const season = await prisma.season.create({
      data: {
        eventId,
        name,
        registrationOpensAt: opensAt,
        registrationClosesAt: closesAt,
        createdByUserId: session.user.id,
      },
    });
    return Response.json({ season: seasonResponse(season, 0, null) }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "This event already has an open Season. Complete or cancel it before starting a new one." }, { status: 409 });
    }
    throw error;
  }
};
