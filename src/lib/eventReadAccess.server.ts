import { getSession, checkOwnership } from "./auth.helpers.server";
import { isEventParticipant } from "./settlement.server";

/**
 * Who may read an Event's financial data (`GET /cost`, `GET /payments`).
 *
 * - Owner or event admin: yes.
 * - Event participant (linked account on the roster): yes.
 * - Anonymous callers on an ownerless UNLISTED event: yes — the link is the
 *   secret and this is the no-account management flow (ADR 0035).
 * - Everyone else: no. In particular, an ownerless PUBLIC event (a discoverable
 *   Open Pickup) and non-participant viewers of an owned event are rejected.
 */
export async function canReadEventFinances(
  request: Request,
  event: { id: string; ownerId: string | null; isPublic: boolean },
): Promise<boolean> {
  const session = await getSession(request);
  if (!session?.user) {
    // Anonymous: only ownerless unlisted events (the link is the capability).
    return event.ownerId === null && !event.isPublic;
  }
  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, event.id);
  if (isOwner || isAdmin) return true;
  return isEventParticipant(event.id, session.user.id);
}
