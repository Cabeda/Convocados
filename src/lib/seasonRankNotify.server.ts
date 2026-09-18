/**
 * Post-game Season Rank push (ADR 0031).
 *
 * When a Game's score is first saved, every account-linked player who appeared
 * in that Game's teamsSnapshot gets a personalized push about their Rank Point
 * movement, deep-linking to the per-event explainer pre-filled with the exact
 * inputs behind that Game. Non-counting Games (friendly, no score) and players
 * without a viewer Rank produce nothing.
 */
import { prisma } from "./db.server";
import { createLogger } from "./logger.server";
import { createT, translations, type Locale } from "./i18n";
import { buildRankExplainerHref, outcomeFromScore } from "./rankExplainer";
import { getViewerGameRank } from "./seasonRank.server";
import { sendPushToUser } from "./push.server";
import {
  DEFAULTS,
  wantsPushWithOverrides,
  type EventFollowOverrides,
} from "./notificationPrefs.server";
import { TIER_NAMES } from "./seasonRank";

const log = createLogger("season-rank-notify");

export interface RankNotifyGame {
  dateTime: Date;
  status: string;
  isFriendly: boolean;
  scoreOne: number | null;
  scoreTwo: number | null;
  teamsSnapshot: string | null;
}

const SUPPORTED_LOCALES = new Set<string>(Object.keys(translations));

function toLocale(value: string | null | undefined): Locale {
  return value && SUPPORTED_LOCALES.has(value) ? (value as Locale) : "en";
}

function parsePlayerNames(value: string | null): string[] {
  if (!value) return [];
  try {
    const teams = JSON.parse(value) as Array<{ players?: Array<{ name?: string }> }>;
    if (!Array.isArray(teams)) return [];
    const names = new Set<string>();
    for (const team of teams) {
      for (const player of team.players ?? []) {
        if (player?.name) names.add(player.name);
      }
    }
    return [...names];
  } catch {
    return [];
  }
}

/**
 * Fire-and-forget: never rejects, never blocks the caller's response. Errors
 * are swallowed and logged.
 */
export async function notifySeasonRankChanges(eventId: string, game: RankNotifyGame): Promise<void> {
  try {
    if (game.status !== "played" || game.isFriendly) return;
    if (game.scoreOne === null || game.scoreTwo === null) return;

    const names = parsePlayerNames(game.teamsSnapshot);
    if (names.length === 0) return;

    const players = await prisma.eventPlayer.findMany({
      where: { eventId, name: { in: names }, userId: { not: null } },
      select: { name: true, userId: true },
    });
    const byUser = new Map<string, string>();
    for (const player of players) {
      if (player.userId && !byUser.has(player.userId)) byUser.set(player.userId, player.name);
    }
    if (byUser.size === 0) return;
    const userIds = [...byUser.keys()];

    const [event, prefsRows, follows, appTokens, subs] = await Promise.all([
      prisma.event.findUnique({ where: { id: eventId }, select: { notificationDefaults: true } }),
      prisma.notificationPreferences.findMany({ where: { userId: { in: userIds } } }),
      prisma.eventFollow.findMany({
        where: { eventId, userId: { in: userIds } },
        select: {
          userId: true,
          mutePlayerActivity: true,
          muteReminders: true,
          mutePostGame: true,
          muteEventDetails: true,
        },
      }),
      prisma.appPushToken.findMany({ where: { userId: { in: userIds } }, select: { userId: true, locale: true } }),
      prisma.pushSubscription.findMany({ where: { userId: { in: userIds } }, select: { userId: true, locale: true } }),
    ]);

    const eventDefaults = event?.notificationDefaults
      ? (JSON.parse(event.notificationDefaults) as Partial<Record<keyof EventFollowOverrides, boolean | null>>)
      : null;

    const prefsMap = new Map(prefsRows.map((p) => [p.userId, { ...DEFAULTS, ...p }]));
    const overridesMap = new Map<string, EventFollowOverrides>(
      follows.map((f) => [
        f.userId,
        {
          mutePlayerActivity: f.mutePlayerActivity,
          muteReminders: f.muteReminders,
          mutePostGame: f.mutePostGame,
          muteEventDetails: f.muteEventDetails,
        },
      ]),
    );

    // Same locale source as the notification queue: the locale stored on each
    // push target. Fall back from web subscription to app token, then English.
    const localeMap = new Map<string, Locale>();
    for (const sub of subs) if (!localeMap.has(sub.userId)) localeMap.set(sub.userId, toLocale(sub.locale));
    for (const token of appTokens) if (!localeMap.has(token.userId)) localeMap.set(token.userId, toLocale(token.locale));

    const outcome = outcomeFromScore(game.scoreOne, game.scoreTwo);

    await Promise.all(
      [...byUser].map(async ([userId, playerName]) => {
        try {
          const prefs = prefsMap.get(userId) ?? DEFAULTS;
          const overrides = overridesMap.get(userId) ?? null;
          // Post-game notifications are Tier 2 / players-only (ADR 0017). Every
          // recipient here played the Game, so isPlayer is always true.
          if (!wantsPushWithOverrides(prefs, "post_game", overrides, eventDefaults, true)) return;

          const rank = await getViewerGameRank(eventId, game, playerName);
          if (!rank || !rank.counted || rank.delta === 0) return;

          const t = createT(localeMap.get(userId) ?? "en");
          const delta = rank.delta > 0 ? `+${rank.delta}` : String(rank.delta);
          const body = rank.provisional
            ? t("notifySeasonRankProvisionalBody", { delta, n: String(rank.gamesThisSeason) })
            : t("notifySeasonRankBody", {
                delta,
                rank: String(rank.after),
                tier: TIER_NAMES[rank.tierAfter] ?? "",
              });
          const url = buildRankExplainerHref(eventId, {
            seasonId: rank.seasonId,
            rank: rank.after,
            delta: rank.delta,
            outcome,
          });

          await sendPushToUser(userId, t("notifySeasonRankTitle"), body, url, { type: "season_rank" });
        } catch (err) {
          log.error({ eventId, userId, err }, "Failed to notify player of Season Rank change");
        }
      }),
    );
  } catch (err) {
    log.error({ eventId, err }, "Failed to notify Season Rank changes");
  }
}
