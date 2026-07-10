import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { getSession, checkOwnership } from "../../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../../lib/apiRateLimit.server";

/**
 * DELETE /api/events/[id]/settle/transactions/[txId]
 *
 * Delete a single transaction by composite id (the same id returned by
 * the GET /transactions list — prefixed with `live-`, `hist-`, `sub-`,
 * `spend-`, or `settle-`).
 *
 * Owner/Admin only. The delete is per-type:
 *   - `live-*`  → delete the PlayerPayment row
 *   - `hist-*`  → mutate the GameHistory.paymentsSnapshot (drop the
 *                 matching player entry) — we do NOT delete the game
 *   - `sub-*`   → delete the MonthlySubscription row
 *   - `spend-*` → delete the ExtrasDeclaration row
 *   - `settle-*`→ delete the WalletTransaction row (audit log entry)
 */
export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const txId = params.txId ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can delete transactions." }, { status: 403 });
  }

  const dashIdx = txId.indexOf("-");
  if (dashIdx < 1) return Response.json({ error: "Invalid transaction id." }, { status: 400 });
  const prefix = txId.slice(0, dashIdx);
  const rawId = txId.slice(dashIdx + 1);
  // For "hist-..." the rest of the id is `${gameHistoryId}-${playerName}`.
  // The player name may itself contain dashes, so split on the FIRST dash
  // and treat the rest as the name.

  try {
    switch (prefix) {
      case "live": {
        await prisma.playerPayment.delete({ where: { id: rawId } });
        return Response.json({ ok: true });
      }
      case "hist": {
        // `rawId` is `${gameHistoryId}-${playerName}`. Player names can't
        // contain slashes but they can contain dashes. Find the gameHistoryId
        // by trying increasingly shorter prefixes.
        const hist = await prisma.gameHistory.findFirst({
          where: { eventId },
          select: { id: true, paymentsSnapshot: true },
        });
        // Simpler: look up by game history id prefix; we stored the id
        // up front as a complete id. The remaining suffix after the game
        // history id is the player name.
        const game = await prisma.gameHistory.findFirst({
          where: { eventId, id: { startsWith: rawId.split("-")[0] } },
          select: { id: true, paymentsSnapshot: true },
        });
        if (!game?.paymentsSnapshot) return Response.json({ error: "Game not found." }, { status: 404 });
        const playerName = rawId.slice(game.id.length + 1);
        const entries = JSON.parse(game.paymentsSnapshot) as Array<{ playerName: string; amount: number; status: string }>;
        const next = entries.filter((e) => e.playerName !== playerName);
        if (next.length === entries.length) return Response.json({ error: "Entry not found." }, { status: 404 });
        await prisma.gameHistory.update({
          where: { id: game.id },
          data: { paymentsSnapshot: JSON.stringify(next) },
        });
        return Response.json({ ok: true });
      }
      case "sub": {
        await prisma.monthlySubscription.delete({ where: { id: rawId } });
        return Response.json({ ok: true });
      }
      case "spend": {
        await prisma.extrasDeclaration.delete({ where: { id: rawId } });
        return Response.json({ ok: true });
      }
      case "settle": {
        await prisma.walletTransaction.delete({ where: { id: rawId } });
        return Response.json({ ok: true });
      }
      default:
        return Response.json({ error: `Unknown transaction prefix: ${prefix}` }, { status: 400 });
    }
  } catch (err) {
    return Response.json({ error: `Delete failed: ${(err as Error).message}` }, { status: 400 });
  }
};
