import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { getSession } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";

/** GET — List invited users for an event (owner only). */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id!;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { ownerId: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!event.ownerId || !session?.user || session.user.id !== event.ownerId) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const invites = await prisma.eventInvite.findMany({
    where: { eventId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });

  return Response.json(invites.map((i) => ({
    id: i.id,
    userId: i.userId,
    name: i.user.name,
    email: i.user.email,
    createdAt: i.createdAt.toISOString(),
  })));
};

/** POST — Invite a user by email (owner only). */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { ownerId: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!event.ownerId || !session?.user || session.user.id !== event.ownerId) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await request.json();
  const { email } = body as { email?: string };

  if (!email || typeof email !== "string") {
    return Response.json({ error: "Email required." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }

  // Don't invite the owner
  if (user.id === event.ownerId) {
    return Response.json({ error: "Cannot invite the event owner." }, { status: 400 });
  }

  // Upsert to avoid duplicates
  const invite = await prisma.eventInvite.upsert({
    where: { eventId_userId: { eventId, userId: user.id } },
    create: { eventId, userId: user.id },
    update: {},
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return Response.json({
    id: invite.id,
    userId: invite.userId,
    name: invite.user.name,
    email: invite.user.email,
    createdAt: invite.createdAt.toISOString(),
  }, { status: 201 });
};

/** DELETE — Remove an invite (owner only). */
export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { ownerId: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!event.ownerId || !session?.user || session.user.id !== event.ownerId) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await request.json();
  const { userId } = body as { userId?: string };

  if (!userId || typeof userId !== "string") {
    return Response.json({ error: "userId required." }, { status: 400 });
  }

  await prisma.eventInvite.deleteMany({
    where: { eventId, userId },
  });

  return Response.json({ ok: true });
};
