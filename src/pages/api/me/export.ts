import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { getSession } from "../../../lib/auth.helpers.server";

/** GET /api/me/export — download all personal data as JSON (GDPR Article 20) */
export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const [user, accounts, sessions, ownedEvents, players, playerRatings, calendarTokens, apiKeys] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          image: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.account.findMany({
        where: { userId },
        select: {
          id: true,
          providerId: true,
          accountId: true,
          createdAt: true,
        },
      }),
      prisma.session.findMany({
        where: { userId },
        select: {
          id: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
          expiresAt: true,
        },
      }),
      prisma.event.findMany({
        where: { ownerId: userId },
        select: {
          id: true,
          title: true,
          location: true,
          dateTime: true,
          sport: true,
          isPublic: true,
          createdAt: true,
        },
      }),
      prisma.player.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          eventId: true,
          createdAt: true,
        },
      }),
      prisma.playerRating.findMany({
        where: { userId },
        select: {
          id: true,
          eventId: true,
          name: true,
          rating: true,
          gamesPlayed: true,
          wins: true,
          draws: true,
          losses: true,
        },
      }),
      prisma.calendarToken.findMany({
        where: { userId },
        select: {
          id: true,
          scope: true,
          scopeId: true,
          createdAt: true,
        },
      }),
      prisma.apiKey.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          prefix: true,
          scopes: true,
          lastUsedAt: true,
          createdAt: true,
        },
      }),
    ]);

  const exportData = {
    exportedAt: new Date().toISOString(),
    user,
    accounts,
    sessions,
    ownedEvents,
    players,
    playerRatings,
    calendarTokens,
    apiKeys: apiKeys.map((k) => ({ ...k, scopes: JSON.parse(k.scopes) })),
  };

  return new Response(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="convocados-data-${userId}.json"`,
    },
  });
};
