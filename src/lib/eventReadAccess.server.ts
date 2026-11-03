import { getSession, checkOwnership, checkEventAdmin } from "./auth.helpers.server";
import { prisma } from "./db.server";
import { checkAccess } from "./eventAccess";
import { isEventParticipant } from "./settlement.server";

/**
 * Who may read an Event's financial data (`GET /cost`, `GET /payments`).
 *
 * - Owner or event admin: yes.
 * - Event participant (linked account on the roster): yes — unless the Event
 *   set an access password, in which case the caller must also hold it.
 * - Anonymous callers on an ownerless UNLISTED event: yes — the link is the
 *   secret and this is the no-account management flow (ADR 0035) — unless the
 *   Event set an access password.
 * - Everyone else: no. In particular, an ownerless PUBLIC event (a discoverable
 *   Open Pickup) and non-participant viewers of an unlocked owned event are rejected.
 *
 * A password-locked Event answers the same gate as its page, its mutations and
 * the payer card: owner/admin, invitee, or an `ev_access` cookie. A participant
 * who never typed the password does not read the full ledger.
 */
export async function canReadEventFinances(
  request: Request,
  event: { id: string; ownerId: string | null; isPublic: boolean; accessPassword: string | null },
  userIdOverride?: string | null,
): Promise<boolean> {
  // Allow callers (e.g. MCP) without an HTTP session to pass their resolved
  // user id explicitly; otherwise resolve from the session cookie as before.
  const hasOverride = arguments.length >= 3;
  const session = hasOverride ? null : await getSession(request);
  const userId = hasOverride ? (userIdOverride ?? null) : (session?.user?.id ?? null);
  const cookieHeader = hasOverride ? null : request.headers.get("cookie");

  // An ownerless UNLISTED Event without a password is the no-account management
  // flow (ADR 0035): the link is the capability, signed in or not.
  if (!event.accessPassword && event.ownerId === null && !event.isPublic) return true;

  if (event.accessPassword) {
    const [isInvited, isAdmin] = userId
      ? await Promise.all([
          prisma.eventInvite.count({ where: { eventId: event.id, userId } }).then((count) => count > 0),
          checkEventAdmin(event.id, userId),
        ])
      : [false, false];
    // The password gate is the whole answer on a locked Event: owner/admin,
    // invitee, or an `ev_access` cookie. Being on the roster is not enough.
    return checkAccess({
      eventOwnerId: event.ownerId,
      accessPassword: event.accessPassword,
      requestUserId: userId,
      cookieHeader,
      eventId: event.id,
      isInvited: isInvited || isAdmin,
    }).granted;
  }

  if (!session?.user && !hasOverride) {
    // Anonymous: only ownerless unlisted events (the link is the capability).
    return event.ownerId === null && !event.isPublic;
  }
  if (hasOverride) {
    // Programmatic (cookie-less) callers: owner/admin or participant.
    if (userId && (userId === event.ownerId || (await checkEventAdmin(event.id, userId)))) return true;
    if (userId) return isEventParticipant(event.id, userId);
    return event.ownerId === null && !event.isPublic;
  }
  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, event.id);
  if (isOwner || isAdmin) return true;
  return isEventParticipant(event.id, session!.user.id);
}
