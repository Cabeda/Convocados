import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { sendAdminRoleNotification } from "../../../../lib/email.server";
import { getNotificationPrefs } from "../../../../lib/notificationPrefs.server";
import { sendPushToUser } from "../../../../lib/push.server";
import { createLogger } from "../../../../lib/logger.server";

const log = createLogger("event-admins");

function getAppUrl(): string {
  return import.meta.env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? "https://convocados.fly.dev";
}

/** GET — List admins for an event (owner only). */
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

  const admins = await prisma.eventAdmin.findMany({
    where: { eventId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });

  return Response.json(admins.map((a) => ({
    id: a.id,
    userId: a.userId,
    name: a.user.name,
    email: a.user.email,
    createdAt: a.createdAt.toISOString(),
  })));
};

/** POST — Add an admin by email (owner only). */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { ownerId: true, title: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!event.ownerId || !session?.user || session.user.id !== event.ownerId) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await request.json();
  const { email, userId: targetUserId } = body as { email?: string; userId?: string };

  if ((!email || typeof email !== "string") && (!targetUserId || typeof targetUserId !== "string")) {
    return Response.json({ error: "Email or userId required." }, { status: 400 });
  }

  const user = targetUserId
    ? await prisma.user.findUnique({ where: { id: targetUserId } })
    : await prisma.user.findUnique({ where: { email: email!.toLowerCase().trim() } });
  if (!user) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }

  if (user.id === event.ownerId) {
    return Response.json({ error: "Cannot add the event owner as admin." }, { status: 400 });
  }

  const admin = await prisma.eventAdmin.upsert({
    where: { eventId_userId: { eventId, userId: user.id } },
    create: { eventId, userId: user.id },
    update: {},
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  // Send notifications (fire-and-forget, respects user prefs)
  const appUrl = getAppUrl();
  const eventUrl = `${appUrl}/events/${eventId}`;
  getNotificationPrefs(admin.userId).then(async (prefs) => {
    const promises: Promise<void>[] = [];
    if (prefs.emailEnabled && admin.user.email) {
      promises.push(sendAdminRoleNotification(admin.user.email, {
        eventTitle: event.title,
        eventUrl,
        action: "added",
      }));
    }
    if (prefs.pushEnabled) {
      promises.push(sendPushToUser(
        admin.userId,
        event.title,
        `You've been added as an admin for ${event.title}`,
        eventUrl,
      ));
    }
    await Promise.all(promises);
  }).catch((err) => log.error({ err, userId: admin.userId, eventId }, "Failed to send admin-added notification"));

  return Response.json({
    id: admin.id,
    userId: admin.userId,
    name: admin.user.name,
    email: admin.user.email,
    createdAt: admin.createdAt.toISOString(),
  }, { status: 201 });
};

/** DELETE — Remove an admin (owner only). */
export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { ownerId: true, title: true },
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

  // Look up the user's email before deleting, so we can notify them
  const removedUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  await prisma.eventAdmin.deleteMany({
    where: { eventId, userId },
  });

  // Send notifications (fire-and-forget, respects user prefs)
  const appUrl = getAppUrl();
  const eventUrl = `${appUrl}/events/${eventId}`;
  getNotificationPrefs(userId).then(async (prefs) => {
    const promises: Promise<void>[] = [];
    if (prefs.emailEnabled && removedUser?.email) {
      promises.push(sendAdminRoleNotification(removedUser.email, {
        eventTitle: event.title,
        eventUrl,
        action: "removed",
      }));
    }
    if (prefs.pushEnabled) {
      promises.push(sendPushToUser(
        userId,
        event.title,
        `You've been removed as admin from ${event.title}`,
        appUrl,
      ));
    }
    await Promise.all(promises);
  }).catch((err) => log.error({ err, userId, eventId }, "Failed to send admin-removed notification"));

  return Response.json({ ok: true });
};
