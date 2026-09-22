import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { getPendingMerge } from "~/lib/mergeCapture.server";

/**
 * GET /api/me/credentials/pending-merge
 * Returns the cross-account merge waiting on interstitial confirm (ADR 0040),
 * or null. Only visible to the session (survivor) user.
 */
export const GET: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "read");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pending = getPendingMerge(session.user.id);
  if (!pending) {
    return Response.json({ pendingMerge: null });
  }

  const absorbed = await prisma.user.findUnique({
    where: { id: pending.absorbedUserId },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  if (!absorbed) {
    return Response.json({ pendingMerge: null });
  }

  const eventCount = await prisma.event.count({ where: { ownerId: absorbed.id } });

  return Response.json({
    pendingMerge: {
      absorbedUserId: absorbed.id,
      absorbedEmail: absorbed.email,
      absorbedName: absorbed.name,
      absorbedCreatedAt: absorbed.createdAt.toISOString(),
      absorbedEventCount: eventCount,
      providerId: pending.providerId,
      accountId: pending.accountId,
    },
  });
};
