/**
 * Android notification channel contract.
 *
 * The FCM client owns the job-type → Android-channel map, and the server owns
 * the job-type list. They drifted: five server types had no Kotlin branch and
 * fell through to the player-activity channel, which users mute to silence
 * join/leave noise. This test parses the Kotlin map and iterates every
 * NotificationJobType, so adding a server type without routing it fails here
 * instead of silently landing in the fallback channel.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  NOTIFICATION_JOB_TYPES,
  type NotificationJobType,
} from "~/lib/notificationQueue.server";

const KOTLIN_SOURCE = resolve(
  __dirname,
  "../../android-app/app/src/main/java/dev/convocados/data/push/ConvocadosFcmService.kt",
);

type AndroidChannel =
  | "CHANNEL_GAME_REMINDERS"
  | "CHANNEL_PLAYER_ACTIVITY"
  | "CHANNEL_POST_GAME"
  | "CHANNEL_PAYMENT_REMINDERS"
  | "CHANNEL_EVENT_UPDATES";

const EXPECTED_CHANNEL: Record<
  NotificationJobType | "payment_payer_check_in",
  AndroidChannel
> = {
  reminder: "CHANNEL_GAME_REMINDERS",
  player_joined: "CHANNEL_PLAYER_ACTIVITY",
  player_left: "CHANNEL_PLAYER_ACTIVITY",
  player_joined_bench: "CHANNEL_PLAYER_ACTIVITY",
  player_left_bench: "CHANNEL_PLAYER_ACTIVITY",
  player_left_promoted: "CHANNEL_PLAYER_ACTIVITY",
  game_full: "CHANNEL_PLAYER_ACTIVITY",
  spot_available: "CHANNEL_PLAYER_ACTIVITY",
  bench_promoted_capacity: "CHANNEL_PLAYER_ACTIVITY",
  rsvp_request: "CHANNEL_PLAYER_ACTIVITY",
  post_game: "CHANNEL_POST_GAME",
  payment_confirmed: "CHANNEL_PAYMENT_REMINDERS",
  payment_self_reported: "CHANNEL_PAYMENT_REMINDERS",
  payment_payer_check_in: "CHANNEL_PAYMENT_REMINDERS",
  payer_assigned: "CHANNEL_PAYMENT_REMINDERS",
  payer_changed: "CHANNEL_PAYMENT_REMINDERS",
  payer_vacant: "CHANNEL_EVENT_UPDATES",
  crew_captain_nominated: "CHANNEL_EVENT_UPDATES",
  crew_captain_accepted: "CHANNEL_EVENT_UPDATES",
  game_cancelled: "CHANNEL_EVENT_UPDATES",
  game_invite: "CHANNEL_EVENT_UPDATES",
  player_invited: "CHANNEL_EVENT_UPDATES",
  event_details: "CHANNEL_EVENT_UPDATES",
  recruitment: "CHANNEL_EVENT_UPDATES",
  few_spots_left: "CHANNEL_EVENT_UPDATES",
};

/** Pre-job-type aliases the client still maps while old payloads drain. */
const LEGACY_CHANNEL_TYPES = new Set([
  "game_reminder",
  "player_activity",
  "payment_reminder",
]);

function parseKotlinChannelMap(): Map<string, AndroidChannel> {
  const source = readFileSync(KOTLIN_SOURCE, "utf-8");
  const start = source.indexOf("fun channelIdFor");
  if (start === -1) throw new Error("channelIdFor not found in ConvocadosFcmService.kt");
  const end = source.indexOf("\n    }", start);
  if (end === -1) throw new Error("channelIdFor body not closed in ConvocadosFcmService.kt");

  const map = new Map<string, AndroidChannel>();
  const body = source.slice(start, end).replace(/\/\/.*$/gm, "");
  const entry = /((?:"[^"]+"\s*,?\s*)+)->\s*(CHANNEL_[A-Z_]+)/g;
  for (const match of body.matchAll(entry)) {
    for (const name of match[1].matchAll(/"([^"]+)"/g)) {
      map.set(name[1], match[2] as AndroidChannel);
    }
  }
  return map;
}

describe("Android notification channel contract", () => {
  const channelMap = parseKotlinChannelMap();

  it("parses the FCM channel map", () => {
    expect(channelMap.size).toBeGreaterThan(0);
  });

  for (const type of NOTIFICATION_JOB_TYPES) {
    it(`${type} maps to ${EXPECTED_CHANNEL[type]}`, () => {
      expect(
        channelMap.get(type),
        `${type} has no FCM channel branch and would fall through to the player-activity channel`,
      ).toBe(EXPECTED_CHANNEL[type]);
    });
  }

  it("maps only job types and known legacy aliases", () => {
    const allowed = new Set<string>([...NOTIFICATION_JOB_TYPES, ...LEGACY_CHANNEL_TYPES]);
    expect([...channelMap.keys()].filter((type) => !allowed.has(type))).toEqual([]);
  });
});
