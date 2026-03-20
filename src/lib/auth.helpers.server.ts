import { auth } from "./auth.server";
import { prisma } from "./db.server";

/**
 * Extract the current session/user from an incoming request.
 * Returns { session, user } or null if not authenticated.
 */
export async function getSession(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session;
}

type SessionResult = Awaited<ReturnType<typeof getSession>>;

/**
 * Check if a user is an admin for a specific event.
 */
export async function checkEventAdmin(eventId: string, userId: string): Promise<boolean> {
  const count = await prisma.eventAdmin.count({
    where: { eventId, userId },
  });
  return count > 0;
}

/**
 * Checks if the authenticated user is the owner or admin of the given event.
 * Accepts an optional pre-fetched session to avoid duplicate lookups.
 * When eventId is provided, also checks the EventAdmin table.
 * Returns { isOwner, isAdmin, session } — session may be null for anonymous users.
 */
export async function checkOwnership(
  request: Request,
  eventOwnerId: string | null,
  existingSession?: SessionResult,
  eventId?: string,
) {
  const session = existingSession ?? await getSession(request);
  const isOwner = !!(session?.user && eventOwnerId && session.user.id === eventOwnerId);

  let isAdmin = false;
  if (!isOwner && eventId && session?.user) {
    isAdmin = await checkEventAdmin(eventId, session.user.id);
  }

  return { isOwner, isAdmin, session };
}
