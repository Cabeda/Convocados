import type { APIRoute } from "astro";
import { prisma, Prisma } from "~/lib/db.server";
import { getSession, checkEventAdmin } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { checkAccess } from "~/lib/eventAccess";

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

  return Response.json({ seasons: result });
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

  const existing = await prisma.season.findFirst({
    where: { eventId, status: { notIn: TERMINAL_STATUSES } },
    select: { id: true },
  });
  if (existing) return Response.json({ error: "This event already has an active Season." }, { status: 409 });

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
      return Response.json({ error: "This event already has an active Season." }, { status: 409 });
    }
    throw error;
  }
};
