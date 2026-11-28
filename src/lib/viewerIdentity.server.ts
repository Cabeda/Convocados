import { prisma } from "./db.server";
import { findViewerName, normalizeName } from "./snapshotParticipants";

/**
 * Who the viewer is on an event: the ONE answer the recap's status and every write behind the recap's
 * tasks (score, MVP vote, payment) read, so the card never offers a task the endpoint then refuses.
 *
 * A ledger name often differs from the account name ("Ana B" vs "anab99"), so the identity is the
 * account name plus the names of the roster rows (Player, EventPlayer) that are linked to this
 * account on this event. Nothing else counts, and no name ever comes from the client.
 */
export interface ViewerUser {
  id?: string | null;
  name?: string | null;
}

/** The account name plus the names of roster rows linked to this account on the event, de-duplicated. */
export async function viewerRosterNames(eventId: string, user: ViewerUser): Promise<string[]> {
  const linked = user.id
    ? await Promise.all([
        prisma.player.findMany({ where: { eventId, userId: user.id }, select: { name: true } }),
        prisma.eventPlayer.findMany({ where: { eventId, userId: user.id }, select: { name: true } }),
      ])
    : [[], []];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [user.name, ...linked[0].map((p) => p.name), ...linked[1].map((p) => p.name)]) {
    const key = normalizeName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name as string);
  }
  return out;
}

/** The name on `roster` the viewer is known by (the roster's own spelling), or null when they are not on it. */
export async function viewerNameOnRoster(eventId: string, user: ViewerUser, roster: readonly string[]): Promise<string | null> {
  return findViewerName(await viewerRosterNames(eventId, user), roster);
}
