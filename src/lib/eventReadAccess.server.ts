import { checkEventAdmin } from "./auth.helpers.server";
import { authenticateRequest } from "./authenticate.server";
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
  // Resolve the caller through the superset auth seam (OAuth, API key, or
  // session cookie) so programmatic and browser callers are treated alike.
  // Callers without an HTTP session (e.g. MCP) may pass their resolved id.
  const hasOverride = arguments.length >= 3;
  const authCtx = hasOverride ? null : await authenticateRequest(request);
  const userId = hasOverride ? (userIdOverride ?? null) : (authCtx?.userId ?? null);
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

  // Unlocked Event: anonymous callers only get ownerless unlisted Events.
  if (!userId) {
    return event.ownerId === null && !event.isPublic;
  }
  if (userId === event.ownerId) return true;
  if (await checkEventAdmin(event.id, userId)) return true;
  return isEventParticipant(event.id, userId);
}
