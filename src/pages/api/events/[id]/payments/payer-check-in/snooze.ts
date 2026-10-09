import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { SNOOZE_HOURS } from "~/lib/payerCheckIn.server";
import { resolvePayerCheckInRequest } from "~/lib/payerCheckInRequest.server";

/**
 * POST /api/events/[id]/payments/payer-check-in/snooze
 * #1236: the payer answers the 24h check-in with "ask me again later" —
 * suppresses the next ask for SNOOZE_HOURS.
 * Body: { gameId }
 */
export const POST: APIRoute = async ({ params, request }) => {
  const resolved = await resolvePayerCheckInRequest(params, request);
  if (!resolved.ok) return resolved.response;
  const { game } = resolved;

  const snoozedUntil = new Date(Date.now() + SNOOZE_HOURS * 60 * 60 * 1000);
  await prisma.game.update({
    where: { id: game.id },
    data: { payerCheckInSnoozedUntil: snoozedUntil },
  });

  return Response.json({ ok: true, snoozedUntil });
};
