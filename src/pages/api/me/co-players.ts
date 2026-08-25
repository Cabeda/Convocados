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
 * Includes BOTH account-linked players (grouped by userId, inviteable) and
 * name-only guests (grouped by name, userId null — add-to-list only). A name
 * that appears as both prefers the registered entry. Same 365-day recency
 * window as ADR 0025 suggestions to keep the query cheap.
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

  // Everyone else in those games. Registered players keyed by userId; guests
  // (userId null) keyed by lowercased name so name-only co-players surface.
  const coPlayRows = await prisma.gameParticipant.findMany({
    where: {
      gameId: { in: myGameIds },
      // Everyone except the caller — including guests (userId null). SQL's
      // `NOT (user_id = ?)` drops NULL rows, so an explicit OR is required.
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
    if (!name && !userId) continue; // nothing to suggest
    const key = userId ? `u:${userId}` : `g:${name.toLowerCase()}`;
    const target = userId ? byUserId : byGuestName;
    const existing = target.get(key);
    const displayName = name || existing?.name || "Unknown";
    if (existing) {
      existing.coPlayCount += 1;
      if (!existing.name || existing.name === "Unknown") existing.name = displayName;
    } else {
      target.set(key, { name: displayName, userId, image: null, coPlayCount: 1 });
    }
  }

  // Resolve profile images for registered candidates in one batch.
  const registeredIds = [...byUserId.keys()].map((k) => k.slice(2));
  if (registeredIds.length > 0) {
    const userRows = await prisma.user.findMany({
      where: { id: { in: registeredIds } },
      select: { id: true, image: true },
    });
    const imageById = new Map(userRows.map((u) => [u.id, u.image]));
    for (const entry of byUserId.values()) {
      entry.image = imageById.get(entry.userId ?? "") ?? null;
    }
  }

  // Registered wins over a guest entry with the same name.
  const byName = new Map<string, CoPlayEntry>();
  for (const entry of byUserId.values()) {
    const nameKey = entry.name.toLowerCase();
    const preferred = byName.get(nameKey);
    if (!preferred || (preferred.userId === null && entry.userId !== null)) byName.set(nameKey, entry);
  }
  for (const entry of byGuestName.values()) {
    const nameKey = entry.name.toLowerCase();
    if (!byName.has(nameKey)) byName.set(nameKey, entry);
  }

  const players = [...byName.values()]
    .filter((p) => p.name && p.name !== "Unknown")
    .sort((a, b) => b.coPlayCount - a.coPlayCount)
    .slice(0, 30);

  return Response.json({ players });
};

