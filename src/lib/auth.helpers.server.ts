import { auth } from "./auth.server";
import { prisma } from "./db.server";

/**
 * Extract the current session/user from an incoming request.
 * Supports both session cookies (via better-auth) and OAuth bearer tokens.
 * Returns { session, user } or null if not authenticated.
 */
export async function getSession(request: Request) {
  // 1. Check for OAuth bearer token first
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ") && !authHeader.startsWith("Bearer cvk_")) {
    const token = authHeader.slice(7);
    const oauthToken = await prisma.oauthAccessToken.findUnique({
      where: { accessToken: token },
    });
    if (oauthToken && oauthToken.userId && oauthToken.accessTokenExpiresAt > new Date()) {
      const user = await prisma.user.findUnique({ where: { id: oauthToken.userId } });
      if (user) {
        return {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            emailVerified: user.emailVerified,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          },
          session: {
            id: `oauth-${oauthToken.accessToken.slice(0, 8)}`,
            userId: user.id,
            expiresAt: oauthToken.accessTokenExpiresAt,
            token: oauthToken.accessToken,
            createdAt: oauthToken.createdAt,
            updatedAt: oauthToken.createdAt,
          },
        };
      }
    }
    // Invalid/expired OAuth token — don't fall through to session
    return null;
  }

  // 2. Fall back to session cookie auth
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
