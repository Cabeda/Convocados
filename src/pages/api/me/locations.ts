import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { getSession } from "../../../lib/auth.helpers.server";
import { authenticateRequest } from "../../../lib/authenticate.server";
import { rateLimitResponse } from "../../../lib/apiRateLimit.server";

const LIMIT = 5;

/**
 * Venues the viewer actually plays at, most frequent first.
 *
 * Backs the create-game form's default location suggestions: the pitches you
 * already use should be one tap away, before you type anything. Derived from
 * the Events the viewer is involved in (owner, admin, or on the roster), so it
 * needs no extra bookkeeping.
 */
export const GET: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "read");
  if (limited) return limited;

  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await prisma.event.findMany({
    where: {
      archivedAt: null,
      location: { not: "" },
      OR: [
        { ownerId: userId },
        { admins: { some: { userId } } },
        { eventPlayers: { some: { userId } } },
      ],
    },
    select: { location: true, latitude: true, longitude: true },
    orderBy: { dateTime: "desc" },
  });

  // Count by name, first-seen wins for the coordinates (most recent event that
  // has them), so a venue the user moved still resolves to its latest pin.
  const byName = new Map<string, { location: string; latitude: number | null; longitude: number | null; count: number }>();
  for (const e of events) {
    const name = e.location.trim();
    if (!name) continue;
    const existing = byName.get(name);
    if (existing) {
      existing.count += 1;
      if (existing.latitude === null && e.latitude !== null && e.longitude !== null) {
        existing.latitude = e.latitude;
        existing.longitude = e.longitude;
      }
    } else {
      byName.set(name, {
        location: name,
        latitude: e.latitude ?? null,
        longitude: e.longitude ?? null,
        count: 1,
      });
    }
  }

  const locations = [...byName.values()]
    .sort((a, b) => b.count - a.count || a.location.localeCompare(b.location))
    .slice(0, LIMIT);

  return Response.json({ locations });
};
