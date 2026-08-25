import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { getSession } from "../../../lib/auth.helpers.server";
import { authenticateRequest } from "../../../lib/authenticate.server";
import { CO_PLAY_WINDOW_DAYS } from "../../../lib/suggestions";

interface CoPlayEntry {
  name: string;
  userId: string | null;
  image: string | null;
  coPlayCount: number;
}

/**
 * GET /api/me/co-players
 *
 * Global co-play list for the authenticated user: people they have played
 * games with across ALL their events, ranked by co-play count (most frequent
 * first). Powers the add-player autocomplete so the input suggests both this
 * event's history (via /known-players) and people the user has played with
 * elsewhere. Auth required.
 *
 * A candidate is keyed by the account it links to:
 *   - EventPlayers with a userId → grouped by userId (inviteable).
 *   - EventPlayers without a userId (added by name, e.g. before account
 *     linking) → grouped by name, then upgraded to the matching registered
 *     User where a name matches (so an account a player later created is
 *     still recognised). Unmatched names stay as name-only guests (add-only).
 *
 * Same 365-day recency window as ADR 0025 suggestions to keep the query cheap.
 */
export const GET: APIRoute = async ({ request }) => {
  const authCtx = await authenticateRequest(request);
  const sessionUserId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!sessionUserId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const windowCutoff = new Date(now.getTime() - CO_PLAY_WINDOW_DAYS * 86_400_000);

  // The caller's participations in the window (any event).
  const myParticipations = await prisma.gameParticipant.findMany({
    where: {
      eventPlayer: { userId: sessionUserId },
      status: "active",
      archivedAt: null,
      game: { dateTime: { gte: windowCutoff } },
    },
    select: { gameId: true },
  });
  const myGameIds = [...new Set(myParticipations.map((p) => p.gameId))];
  if (myGameIds.length === 0) {
    return Response.json({ players: [] });
  }

  // Everyone else in those games. SQL's `NOT (user_id = ?)` drops NULL rows,
  // so an explicit OR keeps guests.
  const coPlayRows = await prisma.gameParticipant.findMany({
    where: {
      gameId: { in: myGameIds },
      eventPlayer: { is: { OR: [{ userId: { not: sessionUserId } }, { userId: null }] } },
      status: "active",
      archivedAt: null,
    },
    select: { eventPlayer: { select: { userId: true, name: true } } },
  });

  const byUserId = new Map<string, CoPlayEntry>();
  const byGuestName = new Map<string, CoPlayEntry>();
  for (const row of coPlayRows) {
    const userId = row.eventPlayer.userId;
    const name = (row.eventPlayer.name ?? "").trim();
    if (userId) {
      const existing = byUserId.get(userId);
      if (existing) {
        existing.coPlayCount += 1;
      } else {
        byUserId.set(userId, { name: name || "Unknown", userId, image: null, coPlayCount: 1 });
      }
    } else {
      const key = name.toLowerCase();
      if (!key) continue;
      const existing = byGuestName.get(key);
      if (existing) {
        existing.coPlayCount += 1;
      } else {
        byGuestName.set(key, { name, userId: null, image: null, coPlayCount: 1 });
      }
    }
  }

  // Upgrade name-only entries to their registered account where a User name
  // matches (case-insensitive in JS). This surfaces account-linked players
  // whose historical EventPlayer rows were added before linking.
  const guestNames = [...byGuestName.values()].map((e) => e.name);
  if (guestNames.length > 0) {
    const users = await prisma.user.findMany({
      where: { name: { in: guestNames } },
      select: { id: true, name: true, image: true },
    });
    const userByLowerName = new Map<string, { id: string; name: string; image: string | null }>();
    for (const u of users) {
      if (!userByLowerName.has(u.name.toLowerCase())) userByLowerName.set(u.name.toLowerCase(), u);
    }
    for (const [key, entry] of byGuestName) {
      const matched = userByLowerName.get(key);
      if (matched && matched.id !== sessionUserId) {
        // Prefer the registered entry; merge co-play counts if both existed.
        const registered = byUserId.get(matched.id);
        if (registered) {
          registered.coPlayCount += entry.coPlayCount;
          if (registered.name === "Unknown") registered.name = entry.name;
        } else {
          byUserId.set(matched.id, { name: matched.name, userId: matched.id, image: matched.image, coPlayCount: entry.coPlayCount });
        }
        byGuestName.delete(key);
      }
    }
  }

  // Resolve profile images for the registered candidates (any still missing).
  const registeredIds = [...byUserId.values()].filter((e) => e.userId && !e.image).map((e) => e.userId!) ;
  if (registeredIds.length > 0) {
    const userRows = await prisma.user.findMany({
      where: { id: { in: registeredIds } },
      select: { id: true, image: true },
    });
    const imageById = new Map(userRows.map((u) => [u.id, u.image]));
    for (const entry of byUserId.values()) {
      if (entry.userId) entry.image = imageById.get(entry.userId) ?? null;
    }
  }

  // Registered wins over an unresolved guest entry with the same name.
  const byName = new Map<string, CoPlayEntry>();
  for (const entry of byUserId.values()) {
    const key = entry.name.toLowerCase();
    const preferred = byName.get(key);
    if (!preferred) byName.set(key, entry);
  }
  for (const entry of byGuestName.values()) {
    const key = entry.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, entry);
  }

  const players = [...byName.values()]
    .filter((p) => p.name && p.name !== "Unknown")
    .sort((a, b) => b.coPlayCount - a.coPlayCount)
    .slice(0, 30);

  return Response.json({ players });
};
