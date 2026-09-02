import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession, checkEventAdmin } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { checkAccess } from "~/lib/eventAccess";

const seasonSelect = {
  id: true,
  eventId: true,
  status: true,
  registrationOpensAt: true,
  registrationClosesAt: true,
  event: { select: { id: true, ownerId: true, accessPassword: true } },
} as const;

type Session = Awaited<ReturnType<typeof getSession>>;

async function getSeason(seasonId: string, eventId: string) {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: seasonSelect,
  });
  if (!season || season.eventId !== eventId) return null;
  return season;
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

async function isEventAdmin(
  event: { id: string; ownerId: string | null },
  session: Session,
): Promise<boolean> {
  const userId = session?.user?.id ?? null;
  if (!userId) return false;
  return event.ownerId === userId || await checkEventAdmin(event.id, userId);
}

function registrationIsOpen(season: {
  status: string;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
}) {
  const now = new Date();
  return season.status === "registration" && season.registrationOpensAt <= now && now < season.registrationClosesAt;
}

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const eventId = params.id ?? "";
  const seasonId = params.seasonId ?? "";
  const season = await getSeason(seasonId, eventId);
  if (!season) return Response.json({ error: "Season not found." }, { status: 404 });
  if (!(await eventAccessAllowed(season.event, session, request))) {
    return Response.json({ error: "Event access required." }, { status: 403 });
  }
  if (!registrationIsOpen(season) && !(await isEventAdmin(season.event, session))) {
    return Response.json({ error: "Season registration is closed." }, { status: 409 });
  }

  let body: { eventPlayerId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (typeof body.eventPlayerId !== "string" || !body.eventPlayerId.trim()) {
    return Response.json({ error: "eventPlayerId is required." }, { status: 400 });
  }

  const eventPlayer = await prisma.eventPlayer.findFirst({
    where: { id: body.eventPlayerId, eventId, userId: session.user.id },
    select: { id: true },
  });
  if (!eventPlayer) {
    return Response.json({ error: "Only your account-linked EventPlayer can join this Season." }, { status: 403 });
  }

  const existing = await prisma.seasonMembership.findUnique({
    where: { seasonId_userId: { seasonId, userId: session.user.id } },
  });
  if (existing && existing.eventPlayerId !== eventPlayer.id) {
    return Response.json({ error: "This account is already registered with another EventPlayer." }, { status: 409 });
  }

  const membership = await prisma.seasonMembership.upsert({
    where: { seasonId_userId: { seasonId, userId: session.user.id } },
    create: { seasonId, eventPlayerId: eventPlayer.id, userId: session.user.id },
    update: { status: "active", withdrawnAt: null },
  });

  return Response.json({ membership }, { status: existing ? 200 : 201 });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const eventId = params.id ?? "";
  const seasonId = params.seasonId ?? "";
  const season = await getSeason(seasonId, eventId);
  if (!season) return Response.json({ error: "Season not found." }, { status: 404 });
  if (!(await eventAccessAllowed(season.event, session, request))) {
    return Response.json({ error: "Event access required." }, { status: 403 });
  }
  if (!registrationIsOpen(season) && !(await isEventAdmin(season.event, session))) {
    return Response.json({ error: "Season registration is closed." }, { status: 409 });
  }

  const membership = await prisma.seasonMembership.findUnique({
    where: { seasonId_userId: { seasonId, userId: session.user.id } },
  });
  if (!membership) return Response.json({ error: "You are not registered for this Season." }, { status: 404 });
  if (membership.status === "withdrawn") return Response.json({ membership }, { status: 200 });

  const withdrawn = await prisma.seasonMembership.update({
    where: { id: membership.id },
    data: { status: "withdrawn", withdrawnAt: new Date() },
  });
  return Response.json({ membership: withdrawn }, { status: 200 });
};
