import { prisma } from "./db.server";

export type EventAction =
  | "player_added"
  | "player_removed"
  | "player_claimed"
  | "player_unclaimed"
  | "payment_updated"
  | "cost_set"
  | "cost_removed"
  | "teams_randomized"
  | "teams_edited"
  | "team_names_changed"
  | "player_order_changed"
  | "player_order_reset"
  | "event_updated"
  | "ownership_claimed"
  | "ownership_relinquished"
  | "ownership_transferred"
  | "recurrence_reset"
  | "event_archived"
  | "event_unarchived";

/**
 * Append an entry to the event activity log.
 * Fire-and-forget — errors are swallowed to avoid breaking mutations.
 */
export async function logEvent(
  eventId: string,
  action: EventAction,
  actor: string | null,
  actorId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await prisma.eventLog.create({
      data: {
        eventId,
        action,
        actor,
        actorId,
        details: JSON.stringify(details),
      },
    });
  } catch {
    // Swallow — logging should never break a mutation
  }
}
