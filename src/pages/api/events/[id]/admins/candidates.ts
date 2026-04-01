import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { getSession } from "../../../../../lib/auth.helpers.server";

/** GET — List admin candidates for an event (owner only).
 *
 *  Without `?q=`, returns logged users who are players in this event,
 *  excluding the owner and existing admins.
 *
 *  With `?q=`, additionally searches all registered users by email.
 *  If the query looks like an email and matches a registered user who
 *  is not already a candidate, that user is appended with `source: "email"`.
 *  If no user is found for an email-like query, a placeholder with
 *  `source: "invite"` is returned so the frontend can offer to send an invite.
 */
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

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const queryLower = query.toLowerCase();

  // Get existing admin userIds to exclude
  const existingAdmins = await prisma.eventAdmin.findMany({
    where: { eventId },
    select: { userId: true },
  });
  const excludeIds = new Set([
    event.ownerId,
    ...existingAdmins.map((a) => a.userId),
  ]);

  // Find players linked to user accounts in this event
  const players = await prisma.player.findMany({
    where: {
      eventId,
      userId: { not: null },
    },
    select: {
      userId: true,
      user: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  // Deduplicate players by userId
  const playerMap = new Map<string, typeof players[number]>();
  for (const p of players) {
    if (p.userId && p.user && !excludeIds.has(p.userId) && !playerMap.has(p.userId)) {
      playerMap.set(p.userId, p);
    }
  }

  const candidates: { userId: string; name: string; email: string; image: string | null; source: "player" | "email" | "invite" }[] = [];

  for (const [, p] of playerMap) {
    if (!p.user) continue;
    // Apply name filter for display
    if (queryLower && !p.user.name.toLowerCase().includes(queryLower)) continue;

    candidates.push({
      userId: p.user.id,
      name: p.user.name,
      email: p.user.email,
      image: p.user.image ?? null,
      source: "player",
    });
  }

  // Sort alphabetically by name
  candidates.sort((a, b) => a.name.localeCompare(b.name));

  // If query looks like an email, try to find a matching registered user
  const isEmailLike = queryLower.includes("@");
  if (isEmailLike) {
    const emailUser = await prisma.user.findUnique({
      where: { email: queryLower },
      select: { id: true, name: true, email: true, image: true },
    });

    if (emailUser && !excludeIds.has(emailUser.id) && !playerMap.has(emailUser.id)) {
      candidates.push({
        userId: emailUser.id,
        name: emailUser.name,
        email: emailUser.email,
        image: emailUser.image ?? null,
        source: "email",
      });
    } else if (emailUser && !excludeIds.has(emailUser.id) && playerMap.has(emailUser.id)) {
      // User is a player but was filtered out by name — add them back as player
      if (!candidates.some((c) => c.userId === emailUser.id)) {
        candidates.push({
          userId: emailUser.id,
          name: emailUser.name,
          email: emailUser.email,
          image: emailUser.image ?? null,
          source: "player",
        });
      }
    } else if (!emailUser) {
      // No registered user — offer invite placeholder
      candidates.push({
        userId: "",
        name: query,
        email: queryLower,
        image: null,
        source: "invite",
      });
    }
  }

  return Response.json(candidates);
};
