import { checkOwnership } from "./auth.helpers.server";
import type { SessionResult } from "./auth.helpers.server";

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
}

/**
 * Single seam for event-mutation authorization (ADR 0035).
 *
 * An event mutation is authorized when the caller is the Owner or an Admin, or
 * when the event is ownerless and unlisted (the share link is the capability).
 * Ownerless public events (discoverable Open Pickups) are rejected until
 * adopted; owned events with a non-owner caller are rejected.
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
  else if (event.ownerId === null && !event.isPublic) role = "ownerless-open";

  return { allowed: role !== "forbidden", role, isOwner, isAdmin, session };
}
