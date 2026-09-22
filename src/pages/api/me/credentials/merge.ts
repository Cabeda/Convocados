import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { getPendingMerge, clearPendingMerge } from "~/lib/mergeCapture.server";
import { mergeUsers } from "~/lib/merge.server";
import { recalculateAllRatings } from "~/lib/elo.server";
import { logger } from "~/lib/logger.server";

/**
 * POST /api/me/credentials/merge
 * Confirms the pending cross-account merge (interstitial, ADR 0040 Q11).
 * Body: { confirm: true }
 */
export const POST: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  if (body.confirm !== true) {
    return Response.json(
      { error: "Confirmation is required to merge accounts." },
      { status: 400 },
    );
  }

  const survivorId = session.user.id;
  const pending = getPendingMerge(survivorId);
  if (!pending) {
    return Response.json({ error: "No pending merge." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction((tx) =>
      mergeUsers(tx, survivorId, pending.absorbedUserId),
    );
    // Player identities were collapsed post-commit; rebuild ELO from the
    // rewritten history. Best-effort — the merge itself already succeeded.
    for (const eventId of result.mergedPlayerEvents) {
      try {
        const event = await prisma.event.findUnique({
          where: { id: eventId },
          select: { eloEnabled: true },
        });
        if (event?.eloEnabled) await recalculateAllRatings(eventId);
      } catch (err) {
        logger.warn({ eventId, err }, "ELO recalc after merge failed");
      }
    }
    clearPendingMerge(survivorId);
    logger.info(
      { survivorId, absorbedId: pending.absorbedUserId, ...result },
      "Cross-account merge completed",
    );
    return Response.json({ ok: true, mergedUserId: survivorId });
  } catch (err) {
    logger.error({ survivorId, err }, "Cross-account merge failed");
    return Response.json({ error: "Could not merge accounts." }, { status: 500 });
  }
};
