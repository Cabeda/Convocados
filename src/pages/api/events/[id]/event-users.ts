import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";

/**
 * GET /api/events/[id]/event-users
 *
 * Returns every user with a Player OR EventPlayer record in the event,
 * plus the event owner and any admins. Used by the Settle page to
 * populate the "Paid by" / "Paid to" pickers in the settle dialog.
 *
 * Response shape: { users: Array<{ id: string, name: string, role: "owner" | "admin" | "player" }> }
 *
 * Distinct on userId (a ghost user has the same id for the EventPlayer
 * and the underlying User).
 */
export const GET: APIRoute = async ({ params }) => {
  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, ownerId: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // EventPlayers (covers the backfilled ghost users + linked users)
  const eventPlayers = await prisma.eventPlayer.findMany({
    where: { eventId, userId: { not: null } },
    include: { user: { select: { id: true, name: true } } },
  });
  const byUser = new Map<string, { id: string; name: string; role: "owner" | "admin" | "player" }>();
  for (const ep of eventPlayers) {
    if (!ep.userId) continue;
    byUser.set(ep.userId, { id: ep.userId, name: ep.user?.name ?? ep.name, role: "player" });
  }

  // Event owner
  if (event.ownerId) {
    const owner = await prisma.user.findUnique({ where: { id: event.ownerId }, select: { id: true, name: true } });
    if (owner) byUser.set(owner.id, { id: owner.id, name: owner.name, role: "owner" });
  }

  // Admins
  const admins = await prisma.eventAdmin.findMany({
    where: { eventId },
    include: { user: { select: { id: true, name: true } } },
  });
  for (const a of admins) {
    if (!byUser.has(a.userId)) {
      byUser.set(a.userId, { id: a.userId, name: a.user.name, role: "admin" });
    }
  }

  const users = [...byUser.values()].sort((a, b) => {
    // Owner first, then admins, then players by name
    const order = { owner: 0, admin: 1, player: 2 } as const;
    if (order[a.role] !== order[b.role]) return order[a.role] - order[b.role];
    return a.name.localeCompare(b.name);
  });

  return Response.json({ users });
};
