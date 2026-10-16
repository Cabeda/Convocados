import { checkOwnership, checkEventAdmin } from "./auth.helpers.server";
import type { SessionResult } from "./auth.helpers.server";
import { prisma } from "./db.server";
import { checkAccess } from "./eventAccess";

/**
 * The role an event-mutation caller holds, resolved at the authorization seam.
 * `ownerless-open` is the no-account flow: the event has no owner and is
 * unlisted, so the share link is the capability (ADR 0035).
 */
export type EventMutationRole = "owner" | "admin" | "ownerless-open" | "forbidden";

export interface EventMutationAuthz {
  /** Convenience flag: true unless role is `forbidden`. */
  allowed: boolean;
  role: EventMutationRole;
  isOwner: boolean;
  isAdmin: boolean;
  session: SessionResult | null;
}

/** The minimal event facts the authorization seam needs. */
export interface AuthorizableEvent {
  id: string;
  ownerId: string | null;
  isPublic: boolean;
  /**
   * The Event's bcrypt hash, or null. Required, not optional: a caller that
   * forgets it would silently skip the password gate on an `ownerless-open`
   * event, which is the one case where the gate matters.
   */
  accessPassword: string | null;
}

/**
 * Single seam for event-mutation authorization (ADR 0035, ADR 0052).
 *
 * An event mutation is authorized when the caller is the Owner or an Admin, or
 * when the event is ownerless and unlisted (the share link is the capability).
 * Ownerless public events (discoverable Open Pickups) are rejected until
 * adopted; owned events with a non-owner caller are rejected.
 *
 * An ownerless event that set a password is NOT open by link alone — the
 * password is the capability, and `checkAccess` holds that rule. This is the
 * one place it can be enforced for every route at once; `status.ts` used to be
 * the only route that checked it, so eleven routes adopting the seam granted
 * `ownerless-open` past a password.
 *
 * Replaces the copy-pasted `!isOwner && !isAdmin && (event.ownerId || event.isPublic)`
 * decision that previously lived in ~40 route handlers.
 */
export async function authorizeEventMutation(
  request: Request,
  event: AuthorizableEvent,
  existingSession?: SessionResult,
): Promise<EventMutationAuthz> {
  const { isOwner, isAdmin, session } = await checkOwnership(
    request,
    event.ownerId,
    existingSession,
    event.id,
  );

  let role: EventMutationRole = "forbidden";
  if (isOwner) role = "owner";
  else if (isAdmin) role = "admin";
  else if (event.ownerId === null && !event.isPublic) {
    role = (await isOpenByLink(request, event, session)) ? "ownerless-open" : "forbidden";
  }

  return { allowed: role !== "forbidden", role, isOwner, isAdmin, session };
}

/**
 * Whether the share link alone authorizes this caller. True unless the Event set
 * a password, in which case the password (or an invitation) must also be held.
 */
async function isOpenByLink(
  request: Request,
  event: AuthorizableEvent,
  session: SessionResult | null,
): Promise<boolean> {
  if (!event.accessPassword) return true;

  // Password-protected: an invite or event-admin role bypasses it, as in
  // `GET /status`. Only reached on a password-protected ownerless event.
  const userId = session?.user?.id ?? null;
  const isInvited = userId
    ? (await prisma.eventInvite.count({ where: { eventId: event.id, userId } })) > 0 ||
      (await checkEventAdmin(event.id, userId))
    : false;

  return checkAccess({
    eventOwnerId: event.ownerId,
    accessPassword: event.accessPassword,
    requestUserId: userId,
    cookieHeader: request.headers.get("cookie"),
    eventId: event.id,
    isInvited,
  }).granted;
}
