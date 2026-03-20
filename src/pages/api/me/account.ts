import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { getSession } from "../../../lib/auth.helpers.server";
import { logger } from "../../../lib/logger.server";

/** DELETE /api/me/account — delete the authenticated user's account and clean up app data */
export const DELETE: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    // Clean up app-specific data in a transaction
    await prisma.$transaction(async (tx) => {
      // 1. Nullify ownership of events (SetNull is in schema, but do it explicitly for clarity)
      await tx.event.updateMany({
        where: { ownerId: userId },
        data: { ownerId: null },
      });

      // 2. Unlink players (SetNull is in schema, but explicit)
      await tx.player.updateMany({
        where: { userId },
        data: { userId: null },
      });

      // 3. Unlink player ratings
      await tx.playerRating.updateMany({
        where: { userId },
        data: { userId: null },
      });

      // 4. Delete calendar tokens (cascade from User, but we're being explicit)
      await tx.calendarToken.deleteMany({ where: { userId } });

      // 5. Delete API keys
      await tx.apiKey.deleteMany({ where: { userId } });

      // 6. Delete rate limit entries for this user (if any keyed by userId)
      // Rate limits are keyed by IP, not userId, so nothing to do here

      // 7. Delete sessions (cascade from User)
      await tx.session.deleteMany({ where: { userId } });

      // 8. Delete accounts (cascade from User)
      await tx.account.deleteMany({ where: { userId } });

      // 9. Delete the user record itself
      await tx.user.delete({ where: { id: userId } });
    });

    logger.info({ userId }, "Account deleted successfully");
    return Response.json({ ok: true });
  } catch (err) {
    logger.error({ userId, err }, "Failed to delete account");
    return Response.json({ error: "Could not delete account." }, { status: 500 });
  }
};
