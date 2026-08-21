import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession, checkEventAdmin } from "../../../../lib/auth.helpers.server";
import { parseRecurrenceRule, nextOccurrence } from "../../../../lib/recurrence";
import { fireWebhooks } from "../../../../lib/webhook.server";
import { autoPriorityEnroll } from "../../../../lib/priority.server";
import { cancelEventJobs, scheduleEventReminders } from "../../../../lib/scheduler.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { logEvent } from "../../../../lib/eventLog.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const isOwner = !!(event.ownerId && session.user.id === event.ownerId);
  const isAdmin = !isOwner ? await checkEventAdmin(event.id, session.user.id) : false;

  if (!isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner or an admin can cancel the game." }, { status: 403 });
  }

  // Find the current game
  const game = event.currentGameId
    ? await prisma.game.findUnique({ where: { id: event.currentGameId } })
    : null;

  if (!game) {
    return Response.json({ error: "No active game to cancel." }, { status: 400 });
  }

  if (game.status === "cancelled") {
    return Response.json({ error: "Game is already cancelled." }, { status: 400 });
  }

  if (game.status === "played") {
    return Response.json({ error: "Cannot cancel a game that has already been played." }, { status: 400 });
  }

  const now = new Date();
  const gameEnd = new Date(game.dateTime.getTime() + (event.durationMinutes ?? 60) * 60_000);
  if (gameEnd < now) {
    return Response.json({ error: "Cannot cancel a game that has already ended." }, { status: 400 });
  }

  // ── Cancel the current game ──────────────────────────────────────────────
  await prisma.game.update({
    where: { id: game.id },
    data: { status: "cancelled" },
  });

  // ── Reverse the cancelled game's payments (ADR 0009) ─────────────────────
  // 1. Archive its GamePayment rows so they never surface on the settlement
  //    page as "payment requested".
  // 2. Reverse the WalletTransaction ledger: a game_cancelled_credit zeroes
  //    each per_game_share debit, and any credit_redeemed (wallet unit) tied
  //    to this game is voided so the unit is restored. Players who had
  //    already paid end up with a refund credit — correct for a cancellation.
  await prisma.gamePayment.updateMany({
    where: { gameId: game.id, archivedAt: null },
    data: { archivedAt: new Date() },
  });

  const chargeDebits = await prisma.walletTransaction.findMany({
    where: {
      eventId: event.id,
      eventInstanceId: game.id,
      reason: "per_game_share",
      direction: "debit",
    },
    select: { userId: true, amountCents: true, currency: true },
  });
  for (const d of chargeDebits) {
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id,
        userId: d.userId,
        amountCents: d.amountCents,
        currency: d.currency,
        direction: "credit",
        gameUnits: 0,
        reason: "game_cancelled_credit",
        eventInstanceId: game.id,
      },
    });
  }

  // Void any wallet-unit redemptions tied to the cancelled game.
  await prisma.walletTransaction.deleteMany({
    where: { eventId: event.id, eventInstanceId: game.id, reason: "credit_redeemed" },
  });

  // Create GameHistory entry
  await prisma.gameHistory.create({
    data: {
      eventId: event.id,
      dateTime: game.dateTime,
      status: "cancelled",
      isFriendly: game.isFriendly,
      teamOneName: event.teamOneName,
      teamTwoName: event.teamTwoName,
    },
  });

  // ── For recurring events: advance to next occurrence ─────────────────────
  if (event.isRecurring) {
    const rule = parseRecurrenceRule(event.recurrenceRule);
    if (rule) {
      const newDateTime = nextOccurrence(event.dateTime, rule, event.dateTime);
      const newNextResetAt = new Date(newDateTime.getTime() + event.durationMinutes * 60 * 1000);

      // Atomically claim the reset (CAS)
      const claimed = await prisma.event.updateMany({
        where: { id: event.id, nextResetAt: event.nextResetAt },
        data: { nextResetAt: newNextResetAt },
      });

      if (claimed.count === 1) {
        const newGame = await prisma.game.create({
          data: { eventId: event.id, dateTime: newDateTime, status: "upcoming" },
        });

        await prisma.event.update({
          where: { id: event.id },
          data: { currentGameId: newGame.id },
        });

        // Clear per-occurrence payments
        const eventCost = await prisma.eventCost.findUnique({
          where: { eventId: event.id },
        });

        if (eventCost) {
          await prisma.playerPayment.deleteMany({ where: { eventCostId: eventCost.id } });
          await prisma.eventCost.update({
            where: { id: eventCost.id },
            data: { tempPaymentMethods: null, tempPaymentDetails: null },
          });
        }

        // Clear team members for the new game (old teams were snapshotted in GameHistory)
        const teamResults = await prisma.teamResult.findMany({
          where: { eventId: event.id },
          select: { id: true },
        });
        if (teamResults.length > 0) {
          await prisma.teamMember.deleteMany({
            where: { teamResultId: { in: teamResults.map((tr) => tr.id) } },
          });
        }

        // Reset notification dedup flags so the next occurrence gets a fresh
        // recruitment / RSVP cycle (T-48h + T-24h reminders schedule separately).
        await prisma.event.update({
          where: { id: event.id },
          data: { dateTime: newDateTime, rsvpCutoffSent: false, recruitment48hSent: false, recruitment24hSent: false },
        });

        // Fire game_reset webhook (non-blocking)
        fireWebhooks(event.id, "game_reset", {
          newDateTime: newDateTime.toISOString(),
        }).catch(() => {});

        // Auto-enroll priority players (non-blocking)
        autoPriorityEnroll(event.id).catch(() => {});

        // Auto-confirm regulars (non-blocking)
        import("../../../../lib/autoConfirm.server")
          .then(({ applyAutoConfirm }) => applyAutoConfirm(event.id))
          .catch(() => {});

        // Reschedule reminder jobs
        cancelEventJobs(event.id)
          .then(() => scheduleEventReminders(event.id, newDateTime, event.durationMinutes))
          .catch(() => {});
      }
    }
  } else {
    // Non-recurring: cancel pending reminder jobs
    cancelEventJobs(event.id).catch(() => {});
  }

  // ── Log the event ────────────────────────────────────────────────────────
  // Per #538: no `game_cancelled` notification is sent. The cancelled game is
  // over — a notification would only create noise. For recurring events, the
  // new occurrence's normal reminder cycle (T-48h RSVP, T-24h urgent, 24h/2h
  // reminders) takes over. For non-recurring, no notification is fired.
  await logEvent(
    event.id,
    "game_cancelled",
    session.user.name ?? null,
    session.user.id ?? null,
  );

  return Response.json({ ok: true });
};
