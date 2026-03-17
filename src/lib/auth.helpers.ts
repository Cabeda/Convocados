import { auth } from "./auth.server";

/**
 * Extract the current session/user from an incoming request.
 * Returns { session, user } or null if not authenticated.
 */
export async function getSession(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session;
}

/**
 * Checks if the authenticated user is the owner of the given event.
 * Returns { isOwner, session } — session may be null for anonymous users.
 */
export async function checkOwnership(request: Request, eventOwnerId: string | null) {
  const session = await getSession(request);
  const isOwner = !!(session?.user && eventOwnerId && session.user.id === eventOwnerId);
  return { isOwner, session };
}
