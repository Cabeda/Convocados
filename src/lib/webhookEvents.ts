/**
 * Single source of truth for webhook event types.
 *
 * ponytail: this list was copy-pasted into the subscribe route, the edit
 * route and the settings UI, and drifted (player_invited was accepted by the
 * UI but silently dropped by both routes). Adding an event here is the only
 * step left.
 *
 * The public docs table in src/pages/docs/api/webhooks.astro is the one list
 * still maintained by hand — keep it in step when you add a type here.
 */
export const WEBHOOK_EVENT_TYPES = [
  "player_joined",
  "player_left",
  "game_full",
  "game_reset",
  "player_invited",
  "game_cancelled",
  "game_payer_set",
  // Timed / scheduling facts — fired from the reminder pipelines and payment
  // escalation (ADR 0051: lean domain events, clients render).
  "game_scheduled",
  "game_rescheduled",
  "reminder",
  "rsvp_request",
  "rsvp_summary",
  "recruitment",
  "payment_nudge",
  "payment_organizer_alert",
  "payer_check_in",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/**
 * Facts about the event's schedule, not about one game. These carry no
 * occurrence and are fetched on demand (ADR 0051).
 */
export const EVENT_SCOPED_EVENT_TYPES = [
  "player_invited",
  "game_scheduled",
  "game_rescheduled",
] as const satisfies readonly WebhookEventType[];

/**
 * Facts about one game of an event. ADR 0051: these carry `gameId` and
 * `dateTime` so a recurring event's occurrences stay distinguishable; a
 * subscriber keys dedupe on (eventId, gameId).
 *
 * Every declared type must appear in exactly one of the two lists — the
 * payload-contract test fails when a new type is left unclassified.
 */
export const OCCURRENCE_SCOPED_EVENT_TYPES = [
  "player_joined",
  "player_left",
  "game_full",
  "game_reset",
  "game_cancelled",
  "game_payer_set",
  "reminder",
  "rsvp_request",
  "rsvp_summary",
  "recruitment",
  "payment_nudge",
  "payment_organizer_alert",
  "payer_check_in",
] as const satisfies readonly WebhookEventType[];

/** True for events whose payload must name the occurrence it describes. */
export function isOccurrenceScoped(eventType: WebhookEventType): boolean {
  return (OCCURRENCE_SCOPED_EVENT_TYPES as readonly string[]).includes(eventType);
}
