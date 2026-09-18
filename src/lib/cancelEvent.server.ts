import { prisma } from "./db.server";
import { parseRecurrenceRule, nextOccurrence } from "./recurrence";
import { fireWebhooks } from "./webhook.server";
import { autoPriorityEnroll } from "./priority.server";
import { cancelEventJobs, scheduleEventReminders } from "./scheduler.server";
import { logEvent } from "./eventLog.server";

export interface CancelActor {
  id: string | null;
  name: string | null;
}

/** Domain error with an HTTP-ish status, mapped by the API and MCP layers. */
export class CancelError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "CancelError";
  }
}

/**
 * Cancel the current Game of an Event and run the full side-effect set
 * (payment reversal, GameHistory snapshot, recurring advance, job reschedule).
 *
 * Shared by `PUT /api/events/[id]/cancel` and the MCP `convocados_cancel_event`
 * tool so both behave identically. Callers are responsible for authorization.
 */
export async function cancelCurrentGame(eventId: string, actor: CancelActor) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new CancelError("Not found.", 404);

  const game = event.currentGameId
    ? await prisma.game.findUnique({ where: { id: event.currentGameId } })
    : null;

  if (!game) throw new CancelError("No active game to cancel.", 400);
  if (game.status === "cancelled") throw new CancelError("Game is already cancelled.", 400);
  if (game.status === "played") {
    throw new CancelError("Cannot cancel a game that has already been played.", 400);
  }

  const now = new Date();
  const gameEnd = new Date(game.dateTime.getTime() + (event.durationMinutes ?? 60) * 60_000);
  if (gameEnd < now) throw new CancelError("Cannot cancel a game that has already ended.", 400);

  // ── Cancel the current game ──────────────────────────────────────────────
  await prisma.game.update({ where: { id: game.id }, data: { status: "cancelled" } });

  // ── Reverse the cancelled game's payments (ADR 0009) ─────────────────────
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

  await prisma.walletTransaction.deleteMany({
    where: { eventId: event.id, eventInstanceId: game.id, reason: "credit_redeemed" },
  });

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

        const eventCost = await prisma.eventCost.findUnique({ where: { eventId: event.id } });
        if (eventCost) {
          await prisma.playerPayment.deleteMany({ where: { eventCostId: eventCost.id } });
          await prisma.eventCost.update({
            where: { id: eventCost.id },
            data: { tempPaymentMethods: null, tempPaymentDetails: null },
          });
        }

        const teamResults = await prisma.teamResult.findMany({
          where: { eventId: event.id },
          select: { id: true },
        });
        if (teamResults.length > 0) {
          await prisma.teamMember.deleteMany({
            where: { teamResultId: { in: teamResults.map((tr) => tr.id) } },
          });
        }

        await prisma.event.update({
          where: { id: event.id },
          data: { dateTime: newDateTime, rsvpCutoffSent: false, recruitment48hSent: false, recruitment24hSent: false },
        });

        fireWebhooks(event.id, "game_reset", {
          newDateTime: newDateTime.toISOString(),
        }).catch(() => {});

        autoPriorityEnroll(event.id).catch(() => {});

        import("./autoConfirm.server")
          .then(({ applyAutoConfirm }) => applyAutoConfirm(event.id))
          .catch(() => {});

        cancelEventJobs(event.id)
          .then(() => scheduleEventReminders(event.id, newDateTime, event.durationMinutes))
          .catch(() => {});
      }
    }
  } else {
    cancelEventJobs(event.id).catch(() => {});
  }

  // Per #538: no game_cancelled notification — the cancelled game is over.
  await logEvent(event.id, "game_cancelled", actor.name, actor.id);

  return { ok: true, gameId: game.id };
}
