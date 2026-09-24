/**
 * "Needs you" — the Home action queue (ADR 0041 increment).
 *
 * A lean, batch computation of the few things the viewer personally has to act
 * on, so Home can answer "what should I do?" and not just "what do I have?".
 * Deliberately NOT built on `computePostGameStatus` (that is per-event and
 * heavy — ~8 queries); this scans a small per-category window in a handful of
 * queries and returns at most a few items.
 *
 * Task set (decision 2026-09-24):
 *  - fill_spots  — owner/admin; kickoff within 72h; at least one open spot
 *  - settle_score— owner/admin; latest game ended; no score; within 7d
 *  - pay_share   — viewer's linked balance > 0; game within 30d
 *  - vote_mvp    — player of the latest game; ended; not voted; within 7d
 *
 * Items are ordered by the deadline that closes them (soonest first) and capped.
 */
import { prisma } from "./db.server";
import { isGameEnded } from "./gameStatus";
import { getActiveRosterState } from "./roster.server";
import { isHistoryParticipant } from "./snapshotParticipants";

export type HomeActionType = "fill_spots" | "settle_score" | "pay_share" | "vote_mvp";

export interface HomeAction {
  type: HomeActionType;
  eventId: string;
  eventTitle: string;
  /** Kickoff of the relevant Game (ISO). */
  dateTime: string;
  timezone: string;
  /** When this task stops being relevant (ISO) — the ordering key. */
  deadline: string;
  spotsLeft?: number;
  amount?: number;
  currency?: string;
}

const HOUR = 3_600_000;
const DAY = 86_400_000;
const FILL_WINDOW_HOURS = 72;
const POST_GAME_WINDOW_DAYS = 7;
const PAY_WINDOW_DAYS = 30;
export const HOME_ACTIONS_LIMIT = 3;
const SCAN_LIMIT = 20;

export async function computeHomeActions(
  userId: string,
  now: Date = new Date(),
): Promise<HomeAction[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!user) return [];
  const userName = user.name;

  const postGameSince = new Date(now.getTime() - POST_GAME_WINDOW_DAYS * DAY);
  const paySince = new Date(now.getTime() - PAY_WINDOW_DAYS * DAY);
  const ownerOrAdmin = [{ ownerId: userId }, { admins: { some: { userId } } }];

  const [fillCandidates, settleCandidates, payments, recentHistories] = await Promise.all([
    // fill_spots candidates
    prisma.event.findMany({
      where: {
        archivedAt: null,
        dateTime: { gte: now, lte: new Date(now.getTime() + FILL_WINDOW_HOURS * HOUR) },
        OR: ownerOrAdmin,
      },
      select: { id: true, title: true, dateTime: true, timezone: true, maxPlayers: true, currentGameId: true },
      orderBy: { dateTime: "asc" },
      take: SCAN_LIMIT,
    }),
    // settle_score candidates — events with a played game in the window
    prisma.event.findMany({
      where: {
        archivedAt: null,
        OR: ownerOrAdmin,
        history: { some: { status: "played", dateTime: { gte: postGameSince } } },
      },
      select: {
        id: true, title: true, timezone: true, durationMinutes: true,
        history: {
          where: { status: "played" },
          orderBy: { dateTime: "desc" },
          take: 1,
          select: { dateTime: true, scoreOne: true, scoreTwo: true },
        },
      },
      take: SCAN_LIMIT,
    }),
    // pay_share — the viewer's unpaid shares on Games in the window
    prisma.gamePayment.findMany({
      where: {
        archivedAt: null,
        status: { in: ["pending", "sent"] },
        eventPlayer: { userId },
        game: { status: { not: "cancelled" }, dateTime: { gte: paySince } },
      },
      select: {
        amount: true,
        game: {
          select: {
            dateTime: true,
            event: { select: { id: true, title: true, timezone: true, durationMinutes: true } },
          },
        },
      },
      take: 200,
    }),
    // vote_mvp — recent played games for events the viewer is involved in
    prisma.gameHistory.findMany({
      where: {
        status: "played",
        dateTime: { gte: postGameSince },
        event: {
          mvpEnabled: true,
          OR: [
            { ownerId: userId },
            { admins: { some: { userId } } },
            { eventPlayers: { some: { userId } } },
          ],
        },
      },
      select: {
        id: true, dateTime: true, teamsSnapshot: true,
        event: { select: { id: true, title: true, timezone: true, durationMinutes: true } },
      },
      orderBy: { dateTime: "desc" },
      take: 50,
    }),
  ]);

  const actions: HomeAction[] = [];

  // ── fill_spots ────────────────────────────────────────────────────────────
  for (const e of fillCandidates) {
    const roster = await getActiveRosterState(e.id, e.maxPlayers, e.currentGameId);
    const spotsLeft = Math.max(0, e.maxPlayers - roster.totalCount);
    if (spotsLeft > 0) {
      actions.push({
        type: "fill_spots",
        eventId: e.id,
        eventTitle: e.title,
        dateTime: e.dateTime.toISOString(),
        timezone: e.timezone,
        deadline: e.dateTime.toISOString(),
        spotsLeft,
      });
    }
  }

  // ── settle_score ──────────────────────────────────────────────────────────
  for (const e of settleCandidates) {
    const h = e.history[0];
    if (!h || !isGameEnded(h.dateTime, e.durationMinutes, now)) continue;
    if (h.scoreOne !== null && h.scoreTwo !== null) continue;
    actions.push({
      type: "settle_score",
      eventId: e.id,
      eventTitle: e.title,
      dateTime: h.dateTime.toISOString(),
      timezone: e.timezone,
      deadline: new Date(h.dateTime.getTime() + e.durationMinutes * 60_000 + POST_GAME_WINDOW_DAYS * DAY).toISOString(),
    });
  }

  // ── pay_share (grouped per Event) ───────────────────────────────────────────
  const payByEvent = new Map<string, { title: string; timezone: string; amount: number; kickoff: number; end: number }>();
  for (const p of payments) {
    const e = p.game.event;
    const kickoff = p.game.dateTime.getTime();
    const end = kickoff + e.durationMinutes * 60_000;
    const cur = payByEvent.get(e.id)
      ?? { title: e.title, timezone: e.timezone, amount: 0, kickoff, end };
    cur.amount += p.amount;
    if (kickoff > cur.kickoff) { cur.kickoff = kickoff; cur.end = end; }
    payByEvent.set(e.id, cur);
  }
  if (payByEvent.size > 0) {
    const costs = await prisma.eventCost.findMany({
      where: { eventId: { in: [...payByEvent.keys()] } },
      select: { eventId: true, currency: true },
    });
    const currencyByEvent = new Map(costs.map((c) => [c.eventId, c.currency]));
    for (const [eventId, v] of payByEvent) {
      actions.push({
        type: "pay_share",
        eventId,
        eventTitle: v.title,
        dateTime: new Date(v.kickoff).toISOString(),
        timezone: v.timezone,
        deadline: new Date(v.end + PAY_WINDOW_DAYS * DAY).toISOString(),
        amount: Math.round(v.amount * 100) / 100,
        currency: currencyByEvent.get(eventId) ?? "EUR",
      });
    }
  }

  // ── vote_mvp (latest played game per event only) ────────────────────────────
  const latestByEvent = new Map<string, (typeof recentHistories)[number]>();
  for (const h of recentHistories) {
    // Query is dateTime desc → the first row seen per event is the latest.
    if (!latestByEvent.has(h.event.id)) latestByEvent.set(h.event.id, h);
  }
  if (latestByEvent.size > 0) {
    const histories = [...latestByEvent.values()];
    const playerRows = await prisma.player.findMany({
      where: { userId, eventId: { in: [...latestByEvent.keys()] } },
      select: { id: true },
    });
    const playerIds = playerRows.map((p) => p.id);
    const votes = await prisma.mvpVote.findMany({
      where: {
        gameHistoryId: { in: histories.map((h) => h.id) },
        OR: [
          ...(playerIds.length > 0 ? [{ voterPlayerId: { in: playerIds } }] : []),
          { voterPlayerId: `name:${userName}` },
        ],
      },
      select: { gameHistoryId: true },
    });
    const votedSet = new Set(votes.map((v) => v.gameHistoryId));
    for (const h of histories) {
      if (!isGameEnded(h.dateTime, h.event.durationMinutes, now)) continue;
      if (!isHistoryParticipant(h, userName)) continue;
      if (votedSet.has(h.id)) continue;
      actions.push({
        type: "vote_mvp",
        eventId: h.event.id,
        eventTitle: h.event.title,
        dateTime: h.dateTime.toISOString(),
        timezone: h.event.timezone,
        deadline: new Date(h.dateTime.getTime() + h.event.durationMinutes * 60_000 + POST_GAME_WINDOW_DAYS * DAY).toISOString(),
      });
    }
  }

  actions.sort((a, b) => {
    const da = new Date(a.deadline).getTime();
    const db = new Date(b.deadline).getTime();
    if (da !== db) return da - db;
    return new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime();
  });

  return actions.slice(0, HOME_ACTIONS_LIMIT);
}
