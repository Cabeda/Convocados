/**
 * Single source of truth for webhook event types.
 *
 * ponytail: this list was copy-pasted into the subscribe route, the edit
 * route and the settings UI, and drifted (player_invited was accepted by the
 * UI but silently dropped by both routes). Adding an event here is the only
 * step left.
 */
export const WEBHOOK_EVENT_TYPES = [
  "player_joined",
  "player_left",
  "game_full",
  "game_reset",
  "player_invited",
  "game_cancelled",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];