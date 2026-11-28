import { checkOwnership, checkEventAdmin } from "./auth.helpers.server";
import type { SessionResult } from "./auth.helpers.server";
import { authenticateRequest, requireScope } from "./authenticate.server";
import { insufficientScopeChallenge } from "./mcp/protocol";
import { prisma } from "./db.server";
import { checkAccess, type AccessResult } from "./eventAccess";

/**
 * A bearer/API-key caller may mutate an Event only with at least one of these.
 * A session cookie carries `["*"]` and passes; a link holder sends no bearer.
 */
export const EVENT_MUTATION_WRITE_SCOPES = ["write:events", "manage:payments"] as const;

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
  /**
   * Why a denial happened, when the client can act on it. `password_required`:
   * the Event is open by link but password-locked, so a client should route the
   * user to the password prompt instead of reporting an ownership problem.
   * `insufficient_scope`: a bearer token without `write:events` or
   * `manage:payments`, which the client must not retry as an ownership error.
   */
  reason?: "password_required" | "insufficient_scope";
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
  let reason: "password_required" | "insufficient_scope" | undefined;
  if (isOwner) role = "owner";
  else if (isAdmin) role = "admin";
  else if (event.ownerId === null && !event.isPublic) {
    const access = await checkLinkAccess(request, event, session);
    if (access.granted) role = "ownerless-open";
    else reason = access.reason;
  }

  // The token's scopes decide independently of role: an owner who authorized a
  // read-only client must not write through it, and a linked participant must
  // not use the payments self-report carve-out to write either.
  if (await lacksEventWriteScope(request)) {
    return { allowed: false, role: "forbidden", isOwner, isAdmin, session, reason: "insufficient_scope" };
  }

  return { allowed: role !== "forbidden", role, isOwner, isAdmin, session, reason };
}

/** Whether the caller authenticated with a bearer/API key lacking both write scopes. */
async function lacksEventWriteScope(request: Request): Promise<boolean> {
  const authCtx = await authenticateRequest(request);
  if (!authCtx) return false;
  return !EVENT_MUTATION_WRITE_SCOPES.some((scope) => requireScope(authCtx, scope));
}

/** The existing `insufficient_scope` 403, with the challenge the MCP clients read. */
export function insufficientScopeResponse(): Response {
  return Response.json(
    { error: "insufficient_scope", scope: EVENT_MUTATION_WRITE_SCOPES.join(" ") },
    {
      status: 403,
      headers: {
        "WWW-Authenticate": insufficientScopeChallenge([...EVENT_MUTATION_WRITE_SCOPES]),
      },
    },
  );
}

/**
 * Routes that keep their own owner/admin rule still need the token-scope guard
 * before they write. Returns the 403 to send, or null to continue.
 */
export async function denyMissingEventWriteScope(request: Request): Promise<Response | null> {
  return (await lacksEventWriteScope(request)) ? insufficientScopeResponse() : null;
}

/**
 * A 403 for a denied mutation. A password-locked Event answers `locked: true`,
 * the same signal `GET /status` gives a read, so a client can route the caller
 * to the password prompt rather than report an ownership problem.
 */
export function eventMutationDenied(authz: EventMutationAuthz, error: string): Response {
  if (authz.reason === "insufficient_scope") return insufficientScopeResponse();
  return Response.json(
    authz.reason === "password_required" ? { error, locked: true } : { error },
    { status: 403 },
  );
}

/**
 * Whether the share link alone authorizes this caller. Granted unless the Event
 * set a password, in which case the password (or an invitation) must also be held.
 */
async function checkLinkAccess(
  request: Request,
  event: AuthorizableEvent,
  session: SessionResult | null,
): Promise<AccessResult> {
  if (!event.accessPassword) return { granted: true };

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
  });
}
