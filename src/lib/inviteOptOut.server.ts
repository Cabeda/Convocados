/**
 * ADR 0025 — invite opt-out + ping-suppression helpers.
 *
 * Two independent opt-out levels:
 *  - EventPlayer.invitationOptOutAt (per-event, reversible, cleared on rejoin):
 *    silences RSVP pings, recruitment/spot-available pings, suggestions and
 *    PlayerInvite creation for that event.
 *  - NotificationPreferences.invitesEnabled (global): kill switch for receiving
 *    invites + being suggested. Does NOT silence RSVP/recruitment pings (those
 *    are attendance checks for people already on the roster, not invites).
 *
 * Phase 1 also suppresses users whose Rsvp.status === "no" on the CURRENT game:
 *  they declined this occurrence, so re-prompting them within the same game is
 *  noise. Suppression is per-game — a recurrence reset creates a fresh pending
 *  Rsvp and they get asked once per new game.
 */

import { prisma } from "./db.server";

/** User ids to EXCLUDE from RSVP + recruitment/spot-available pings for an event:
 *  users whose this-event EventPlayer is opted out, plus users who declined (rsvp=no)
 *  the current game. */
export async function getPingSuppressedUserIds(eventId: string): Promise<Set<string>> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { currentGameId: true },
  });

  const suppressed = new Set<string>();

  const eps = await prisma.eventPlayer.findMany({
    where: { eventId },
    select: { id: true, userId: true, invitationOptOutAt: true },
  });

  for (const ep of eps) {
    if (!ep.userId) continue;
    if (ep.invitationOptOutAt) suppressed.add(ep.userId);
  }

  if (event?.currentGameId) {
    const declined = await prisma.rsvp.findMany({
      where: { gameId: event.currentGameId, eventPlayerId: { in: eps.map((e) => e.id) }, status: "no" },
      select: { eventPlayerId: true },
    });
    const declinedEpIds = new Set(declined.map((r) => r.eventPlayerId));
    for (const ep of eps) {
      if (ep.userId && declinedEpIds.has(ep.id)) suppressed.add(ep.userId);
    }
  }

  return suppressed;
}

/** Per-event opt-out check for a single EventPlayer row (with userId). */
export function isEventInviteOptedOut(ep: { invitationOptOutAt: Date | null }): boolean {
  return ep.invitationOptOutAt !== null;
}