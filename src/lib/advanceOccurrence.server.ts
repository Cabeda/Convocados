import { Prisma, prisma } from "./db.server";
import { parseRecurrenceRule, nextOccurrence } from "./recurrence";
import { fireWebhooks } from "./webhook.server";
import { autoPriorityEnroll } from "./priority.server";
import { cancelEventJobs, scheduleEventReminders } from "./scheduler.server";
import { syncGamePayments } from "./settlement.server";
import { applyAutoConfirm } from "./autoConfirm.server";
import { createLogger } from "./logger.server";

const log = createLogger("advanceOccurrence");

/**
 * Outcome of an advance attempt:
 * - "advanced"   — this caller won the CAS and the occurrence moved forward
 * - "concurrent" — another caller advanced it first (state already moved)
 * - "not-due"    — guards failed (archived, not recurring, future, bad rule)
 */
export type AdvanceResult = "advanced" | "concurrent" | "not-due";

export type EventForAdvance = Prisma.EventGetPayload<{
  include: { teamResults: { include: { members: true } } };
}>;

/**
 * Advance a due recurring occurrence (issue #1176): the single CAS reset path
 * shared by the lazy reset (event GET) and the eager cron sweep. Winning the
 * `nextResetAt` compare-and-swap guarantees exactly one snapshot per
 * occurrence regardless of which trigger fires first.
 *
 * On win: snapshot teams+payments into GameHistory, roll the Game pointer
 * (ADR 0016), reset per-occurrence flags/state, re-arm reminders, then fire
 * game_reset webhook + priority/auto-confirm side effects (non-blocking).
 * Archived events are frozen: never advanced, never re-armed.
 */
export async function advanceDueRecurringEvent(
  event: EventForAdvance,
): Promise<AdvanceResult> {
  if (event.archivedAt || !event.isRecurring || !event.nextResetAt) {
    return "not-due";
  }
  const now = new Date();
  if (event.nextResetAt > now) return "not-due";
  const rule = parseRecurrenceRule(event.recurrenceRule);
  if (!rule) return "not-due";

  const currentNextResetAt = event.nextResetAt;
  const newDateTime = nextOccurrence(event.dateTime, rule, now);
  const newNextResetAt = new Date(newDateTime.getTime() + event.durationMinutes * 60 * 1000);

  // Atomically claim the reset — only one concurrent caller gets count=1.
  const claimed = await prisma.event.updateMany({
    where: { id: event.id, nextResetAt: currentNextResetAt },
    data: { nextResetAt: newNextResetAt },
  });
  if (claimed.count === 0) return "concurrent";

  const teamsSnapshot =
    event.teamResults.length > 0
      ? JSON.stringify(
          event.teamResults.map((tr) => ({
            team: tr.name,
            formation: tr.formation,
            players: tr.members.map((m) => ({ name: m.name, order: m.order, slot: m.slot })),
          })),
        )
      : null;

  // Snapshot payments before reset
  const eventCost = await prisma.eventCost.findUnique({
    where: { eventId: event.id },
    include: { payments: true },
  });
  const paymentsSnapshot =
    eventCost && eventCost.payments.length > 0
      ? JSON.stringify(
          eventCost.payments.map((p) => ({
            playerName: p.playerName,
            amount: p.amount,
            status: p.status,
            method: p.method,
          })),
        )
      : null;

  // ADR 0016: mark old Game as played + create new Game + swap pointer.
  // Payment overhaul: carry paymentMode to the next occurrence; carry the
  // payer only if they were an active participant of the previous game.
  const oldGameId = event.currentGameId;
  let inheritMode: string | null = null;
  let inheritPayerId: string | null = null;
  if (oldGameId) {
    const oldGame = await prisma.game.findUnique({
      where: { id: oldGameId },
      select: { paymentMode: true, payerEventPlayerId: true },
    });
    inheritMode = oldGame?.paymentMode ?? null;
    if (oldGame?.payerEventPlayerId) {
      const payerStillActive = await prisma.gameParticipant.findFirst({
        where: { gameId: oldGameId, eventPlayerId: oldGame.payerEventPlayerId, archivedAt: null },
        select: { id: true },
      });
      if (payerStillActive) inheritPayerId = oldGame.payerEventPlayerId;
    }
  }
  const newGame = await prisma.game.create({
    data: {
      eventId: event.id,
      dateTime: newDateTime,
      status: "upcoming",
      paymentMode: inheritMode,
      payerEventPlayerId: inheritPayerId,
    },
  });
  if (oldGameId) {
    await prisma.game.update({
      where: { id: oldGameId },
      data: { status: "played" },
    });
  }
  await prisma.event.update({
    where: { id: event.id },
    data: { currentGameId: newGame.id },
  });

  // Payment overhaul: reconcile the new game's payment rows (no-op until
  // the roster is populated, but keeps carried-over payments in sync).
  syncGamePayments(newGame.id, event.id).catch(() => {});

  // ADR 0016: keep GameHistory for backward compat (read-only fallback),
  // but NO destructive deletes. Players/Teams/RSVPs stay intact on the old Game.
  // Guard against a duplicate snapshot: one may already exist if a score was
  // saved on the played Game before the reset ran (history PATCH materialises
  // a GameHistory on demand).
  const existingSnapshot = await prisma.gameHistory.findFirst({
    where: { eventId: event.id, dateTime: event.dateTime },
  });
  await prisma.$transaction([
    ...(existingSnapshot
      ? []
      : [
          prisma.gameHistory.create({
            data: {
              eventId: event.id,
              dateTime: event.dateTime,
              teamOneName: event.teamOneName,
              teamTwoName: event.teamTwoName,
              teamsSnapshot,
              paymentsSnapshot,
            },
          }),
        ]),
    // Clear per-occurrence payments (PlayerPayment is still current-game-scoped until GamePayment migration)
    ...(eventCost
      ? [
          prisma.playerPayment.deleteMany({ where: { eventCostId: eventCost.id } }),
          prisma.eventCost.update({
            where: { id: eventCost.id },
            data: { tempPaymentMethods: null, tempPaymentDetails: null },
          }),
        ]
      : []),
    // Clear team members for the new game (teams are snapshotted in GameHistory above)
    ...event.teamResults.map((tr) =>
      prisma.teamMember.deleteMany({ where: { teamResultId: tr.id } }),
    ),
    prisma.event.update({
      where: { id: event.id },
      data: {
        dateTime: newDateTime,
        rsvpCutoffSent: false,
        recruitment48hSent: false,
        recruitment24hSent: false,
      },
    }),
  ]);

  // Re-arm reminders for the new occurrence (awaited: callers — notably the
  // cron sweep — must not report success before jobs exist again).
  await cancelEventJobs(event.id);
  await scheduleEventReminders(event.id, newDateTime, event.durationMinutes);

  // Fire game_reset webhook (non-blocking)
  fireWebhooks(event.id, "game_reset", {
    newDateTime: newDateTime.toISOString(),
  }).catch(() => {});

  // Auto-enroll priority players for the new occurrence (non-blocking)
  autoPriorityEnroll(event.id).catch(() => {});

  // ADR 0018: Auto-confirm regulars for the new occurrence (non-blocking)
  applyAutoConfirm(event.id).catch(() => {});

  log.info(
    { eventId: event.id, newDateTime: newDateTime.toISOString() },
    "advanced recurring occurrence",
  );
  return "advanced";
}
