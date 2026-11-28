/**
 * THROWAWAY prototype seed — "worst case clutter" post-game event.
 *
 *   pnpm db:seed:prototype-postgame
 *
 * One very complex, JUST-ENDED weekly game modelled on a recurring group, so the
 * event page (/events/<id>) shows its fullest post-game state at once. It exists
 * to compare post-game UX prototypes against realistic worst-case data, not as
 * a feature seed. Safe to delete together with its package.json script.
 *
 * Sign in as demo@convocados.app / demo123 (the demo user is the event owner AND
 * a player on the WINNING team, has NOT voted for MVP and has NOT paid).
 *
 * ── Which state this seeds, and why ─────────────────────────────────────────
 * The page's wrap-up (PostGameBanner) needs `postGameStatus.gameEnded === true`,
 * i.e. Event.dateTime + durationMinutes <= now. A *real* recurring event, once
 * its occurrence ends, is advanced by `advanceDueRecurringEvent` (lazy on
 * GET /api/events/:id, or by the cron sweep) as soon as `nextResetAt <= now`:
 * Event.dateTime jumps to the next occurrence, the ended game is frozen into
 * GameHistory and the banner then only survives via `hasPendingPastPayments`
 * (gameEnded is false). That "already reset" state does NOT satisfy the brief.
 *
 * So this seed produces the state *between* the final whistle and the reset:
 *   - Event.dateTime        = 100 min ago, durationMinutes 90 → ended 10 min ago
 *   - Event.isRecurring     = true, weekly rule, so the page is a recurring group
 *   - Event.nextResetAt     = now + 7 days   ← deliberately in the FUTURE, so the
 *                             lazy reset does not fire on the first page load and
 *                             wipe the ended state. (Real code would set it to
 *                             dateTime + duration, which is already past.)
 *   - Event.currentGameId   → Game (status "played", scored 7–6)
 *   - GameHistory (same dateTime) holds the score, teamsSnapshot and 7 earlier
 *     counted games, exactly as the score PATCH materialises it.
 * To see the true post-reset state, just load the page after setting
 * `nextResetAt` into the past (the lazy reset runs on the next GET).
 *
 * ── What is seeded ──────────────────────────────────────────────────────────
 * Football (sport id football-7v7 — there is no 8v8 id) with maxPlayers 16:
 * 16 players who played, 3 benched who did not, 1 no-show (flagged on
 * GameParticipant), 2 declined (Rsvp "no"); account-linked + anonymous mix;
 * balanced teams with Elo + custom names; 7–6 final score with Match Events
 * (goals incl. a hat-trick, an own goal, a penalty, assists); an ACTIVE Season
 * with 13 members in two Crews (one captain each) and 7 earlier counted games so
 * the Rank reveal + Crew line render; MVP voting open with votes cast but none
 * from the demo user; €80 pitch split 16 ways (€5.00) with paid/sent/pending
 * rows, one collector (Game payer) and the demo user owing €5.00 unpaid.
 * Skipped: yellow/red cards (MatchEvent only models goal/assist), Stakes Preview
 * (the app only shows it for the next UNSCORED game, never alongside a scored
 * one), push prompts / invitations / webhooks (out of scope), wallet ledger rows.
 *
 * All names/emails are faker-generated (seeded → deterministic); no real PII.
 * Idempotent: wipes the event titled TITLE (cascade) and the users it created.
 */
import { faker } from "@faker-js/faker";
import { readFileSync } from "node:fs";
import { prisma, prismaReady } from "../src/lib/db.server";

const TITLE = "Ninjas (complex post-game prototype)";
const TZ = "Europe/Lisbon";
const DEMO_EMAIL = "demo@convocados.app";
const DEMO_ID = "demo-organizer-001";
const DEMO_PASSWORD_HASH =
  "e85e17b8ccf0231ecc33406b98bf41b3:ac313125f11ad360382987c4c993c93d0346878a4ae3959669711822323fb8c5ac57f53975466b90b60f38ab5e81c263bbabcd821cab003641e4342f92e9dc45";
const USER_PREFIX = "proto-pg-";
const TEAM_ONE = "Shadow Foxes";
const TEAM_TWO = "Iron Owls";
const MAX_PLAYERS = 16;
const DURATION_MIN = 90;
const COST_TOTAL = 80;
const SHARE = COST_TOTAL / MAX_PLAYERS; // €5.00

const MIN = 60_000;
const DAY = 86_400_000;
const NOW = Date.now();
/** The just-ended occurrence: kicked off 100 min ago, 90 min long → ended 10 min ago. */
const GAME_DATE = new Date(NOW - 100 * MIN);

faker.seed(20261105);

function localBase(): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  try {
    const p = readFileSync(".dev-port", "utf8").trim();
    if (p) return `http://localhost:${p}`;
  } catch { /* fall through */ }
  return "http://localhost:4321";
}

type Role = "starter" | "ghost" | "bench-played" | "bench" | "declined";

interface Spec {
  name: string;
  /** null = anonymous (no account). */
  userId: string | null;
  role: Role;
  /** Roster order (declined players sit after the bench). */
  order: number;
  rating: number;
  games: number;
  // Filled in once rows exist:
  eventPlayerId?: string;
  playerId?: string;
}

const uniqueNames = new Set<string>();
function fakeName(): string {
  let n = faker.person.fullName();
  while (uniqueNames.has(n)) n = faker.person.fullName();
  uniqueNames.add(n);
  return n;
}

function shuffled<T>(items: T[]): T[] {
  return faker.helpers.shuffle([...items]);
}

/** Snake-draft split by rating → near-equal team averages. Returns [one, two]. */
function balancedSplit<T extends { rating: number }>(players: T[]): [T[], T[]] {
  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  const one: T[] = [];
  const two: T[] = [];
  // A B B A  A B B A … keeps both sides' averages within a few points.
  sorted.forEach((p, i) => (i % 4 === 0 || i % 4 === 3 ? one : two).push(p));
  return [one, two];
}

function avg(items: Array<{ rating: number }>): number {
  return Math.round(items.reduce((s, p) => s + p.rating, 0) / Math.max(1, items.length));
}

function weekdayCode(date: Date): string {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(date);
  return ({ Mon: "MO", Tue: "TU", Wed: "WE", Thu: "TH", Fri: "FR", Sat: "SA", Sun: "SU" } as Record<string, string>)[wd] ?? "MO";
}

async function ensureDemoUser() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  const demo =
    existing ??
    (await prisma.user.create({ data: { id: DEMO_ID, name: "Demo Organizer", email: DEMO_EMAIL, emailVerified: true } }));
  const hasCredential = await prisma.account.findFirst({ where: { userId: demo.id, providerId: "credential" } });
  if (!hasCredential) {
    await prisma.account.create({
      data: { id: `account-${demo.id}`, accountId: demo.id, providerId: "credential", issuer: "local:credential", userId: demo.id, password: DEMO_PASSWORD_HASH },
    });
  }
  return demo;
}

async function wipePrevious() {
  const events = await prisma.event.findMany({ where: { title: TITLE }, select: { id: true } });
  for (const e of events) await prisma.event.delete({ where: { id: e.id } }); // cascades Game/History/Season/…
  await prisma.user.deleteMany({ where: { id: { startsWith: USER_PREFIX } } });
}

function buildSpecs(demoName: string, demoId: string): Spec[] {
  // Anonymous among the starters: idx 4, 7 (ghost), 9, 11, 13.
  const anonStarters = new Set([4, 7, 9, 11, 13]);
  let linkedCounter = 0;
  const userFor = (): string => `${USER_PREFIX}${++linkedCounter}`;
  const specs: Spec[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const isDemo = i === 0;
    const anon = anonStarters.has(i);
    specs.push({
      name: isDemo ? demoName : fakeName(),
      userId: isDemo ? demoId : anon ? null : userFor(),
      role: i === 7 ? "ghost" : "starter",
      order: i,
      rating: isDemo ? 1105 : faker.number.int({ min: 900, max: 1300 }),
      games: isDemo ? 18 : faker.number.int({ min: 6, max: 30 }),
    });
  }
  // Bench: #16 linked (steps in for the ghost and plays), #17 linked, #18/#19 anonymous.
  const bench: Array<{ linked: boolean; role: Role }> = [
    { linked: true, role: "bench-played" },
    { linked: true, role: "bench" },
    { linked: false, role: "bench" },
    { linked: false, role: "bench" },
  ];
  bench.forEach((b, i) => {
    specs.push({
      name: fakeName(),
      userId: b.linked ? userFor() : null,
      role: b.role,
      order: MAX_PLAYERS + i,
      rating: faker.number.int({ min: 900, max: 1250 }),
      games: faker.number.int({ min: 2, max: 14 }),
    });
  });
  // Declined (Rsvp "no", not on the roster).
  specs.push({ name: fakeName(), userId: userFor(), role: "declined", order: MAX_PLAYERS + 4, rating: faker.number.int({ min: 950, max: 1200 }), games: 12 });
  specs.push({ name: fakeName(), userId: null, role: "declined", order: MAX_PLAYERS + 5, rating: faker.number.int({ min: 950, max: 1200 }), games: 5 });
  return specs;
}

interface Goal {
  team: "one" | "two";
  scorer: Spec;
  assist: Spec | null;
  minute: number | null;
  count: number;
  ownGoal: boolean;
  penalty: boolean;
}

/** Goal timeline whose Σcount per side equals the scoreline (ADR 0039). */
function buildGoals(
  scoreOne: number,
  scoreTwo: number,
  teamOne: Spec[],
  teamTwo: Spec[],
  rich: boolean,
): Goal[] {
  const goals: Goal[] = [];
  let minute = faker.number.int({ min: 2, max: 8 });
  const next = () => {
    const m = minute;
    minute += faker.number.int({ min: 2, max: 9 });
    return Math.min(m, 89);
  };
  const side = (team: "one" | "two", score: number) => {
    const own = team === "one" ? teamOne : teamTwo;
    const other = team === "one" ? teamTwo : teamOne;
    let remaining = score;
    if (rich && score >= 5) {
      // a hat-trick as one count=3 row
      goals.push({ team, scorer: faker.helpers.arrayElement(own), assist: null, minute: next(), count: 3, ownGoal: false, penalty: false });
      remaining -= 3;
      // an own goal by the OTHER side, credited to this team (team = scorer's own side)
      const og = faker.helpers.arrayElement(other);
      goals.push({ team: team === "one" ? "two" : "one", scorer: og, assist: null, minute: next(), count: 1, ownGoal: true, penalty: false });
      remaining -= 1;
      // a penalty
      goals.push({ team, scorer: faker.helpers.arrayElement(own), assist: null, minute: next(), count: 1, ownGoal: false, penalty: true });
      remaining -= 1;
    }
    for (; remaining > 0; remaining--) {
      const scorer = faker.helpers.arrayElement(own);
      const assistPool = own.filter((p) => p !== scorer);
      const assist = rich || Math.random() < 0.5 ? faker.helpers.arrayElement(assistPool) : null;
      goals.push({ team, scorer, assist: Math.random() < 0.65 ? assist : null, minute: next(), count: 1, ownGoal: false, penalty: false });
    }
  };
  side("one", scoreOne);
  side("two", scoreTwo);
  return goals.sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));
}

async function main() {
  await prismaReady;
  console.log("Wiping previous prototype…");
  await wipePrevious();

  const demo = await ensureDemoUser();
  const specs = buildSpecs(demo.name, demo.id);
  const demoSpec = specs[0]!;
  const collectorSpec = specs[2]!; // linked starter ≠ demo

  // ── Users for account-linked players (demo already exists) ────────────────
  for (const s of specs) {
    if (!s.userId || s.userId === demo.id) continue;
    await prisma.user.create({
      data: {
        id: s.userId,
        name: s.name,
        email: `${s.userId}@postgame-proto.test`,
        emailVerified: true,
      },
    });
  }

  // ── Teams for the just-ended game: balanced, demo on the winning (one) side ─
  const played = specs.filter((s) => s.role === "starter" || s.role === "bench-played");
  let [sideOne, sideTwo] = balancedSplit(played);
  if (!sideOne.includes(demoSpec)) [sideOne, sideTwo] = [sideTwo, sideOne];
  const byRating = (a: Spec, b: Spec) => b.rating - a.rating;
  sideOne = [...sideOne].sort(byRating);
  sideTwo = [...sideTwo].sort(byRating);
  const SCORE_ONE = 7;
  const SCORE_TWO = 6;

  // ── Event ──────────────────────────────────────────────────────────────────
  const event = await prisma.event.create({
    data: {
      title: TITLE,
      location: `${faker.location.streetAddress()}, ${faker.location.city()}`,
      timezone: TZ,
      dateTime: GAME_DATE,
      durationMinutes: DURATION_MIN,
      maxPlayers: MAX_PLAYERS,
      sport: "football-7v7",
      teamOneName: TEAM_ONE,
      teamTwoName: TEAM_TWO,
      isPublic: false,
      balanced: true,
      eloEnabled: true,
      rankEnabled: true,
      showCompetitiveData: true,
      hideEloInTeams: false,
      mvpEnabled: true,
      splitCostsEnabled: true,
      isRecurring: true,
      recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: weekdayCode(GAME_DATE) }),
      // Future on purpose — see header. Keeps the lazy reset from firing.
      nextResetAt: new Date(NOW + 7 * DAY),
      ownerId: demo.id,
    },
  });

  // ── EventPlayer + legacy Player + PlayerRating ─────────────────────────────
  for (const s of specs) {
    const wins = Math.round(s.games * 0.5);
    const draws = Math.round(s.games * 0.1);
    const losses = s.games - wins - draws;
    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: s.name, userId: s.userId, rating: s.rating, gamesPlayed: s.games, wins, draws, losses },
    });
    s.eventPlayerId = ep.id;
    const pl = await prisma.player.create({
      data: { eventId: event.id, name: s.name, userId: s.userId, order: s.order },
    });
    s.playerId = pl.id;
    await prisma.playerRating.create({
      data: { eventId: event.id, name: s.name, userId: s.userId, rating: s.rating, gamesPlayed: s.games, wins, draws, losses },
    });
  }

  // ── The current (just-ended) Game ──────────────────────────────────────────
  const game = await prisma.game.create({
    data: {
      eventId: event.id,
      dateTime: GAME_DATE,
      status: "played",
      scoreOne: SCORE_ONE,
      scoreTwo: SCORE_TWO,
      teamOneName: TEAM_ONE,
      teamTwoName: TEAM_TWO,
      source: "live",
      eloProcessed: false,
      paymentMode: "tracked",
      payerEventPlayerId: collectorSpec.eventPlayerId!,
    },
  });
  await prisma.event.update({
    where: { id: event.id },
    data: { currentGameId: game.id, defaultPayerEventPlayerId: collectorSpec.eventPlayerId! },
  });

  const teamNameOf = (s: Spec): string | null =>
    sideOne.includes(s) ? TEAM_ONE : sideTwo.includes(s) ? TEAM_TWO : null;
  const slotOf = (s: Spec): number | null => {
    const arr = sideOne.includes(s) ? sideOne : sideTwo.includes(s) ? sideTwo : null;
    return arr ? arr.indexOf(s) : null;
  };

  for (const s of specs.filter((x) => x.role !== "declined")) {
    await prisma.gameParticipant.create({
      data: {
        gameId: game.id,
        eventPlayerId: s.eventPlayerId!,
        order: s.order,
        noShow: s.role === "ghost",
        team: teamNameOf(s),
        slot: slotOf(s),
      },
    });
  }
  // RSVPs: everyone on the roster said yes; the two declined said no.
  for (const s of specs) {
    await prisma.rsvp.create({
      data: {
        gameId: game.id,
        eventPlayerId: s.eventPlayerId!,
        status: s.role === "declined" ? "no" : "yes",
        respondedAt: new Date(NOW - 3 * DAY),
        respondedByUserId: s.userId,
      },
    });
  }

  // Live TeamResult (the current game's lineup is read from here for payments).
  for (const [name, side] of [[TEAM_ONE, sideOne], [TEAM_TWO, sideTwo]] as const) {
    await prisma.teamResult.create({
      data: {
        eventId: event.id,
        name,
        members: { create: side.map((p, i) => ({ name: p.name, order: i, slot: i })) },
      },
    });
  }

  // ── GameHistory for the just-ended game (score + lineup snapshot) ──────────
  const snapshotOf = (a: Spec[], b: Spec[]) =>
    JSON.stringify([
      { team: TEAM_ONE, players: a.map((p, order) => ({ name: p.name, order, slot: order })) },
      { team: TEAM_TWO, players: b.map((p, order) => ({ name: p.name, order, slot: order })) },
    ]);
  const latest = await prisma.gameHistory.create({
    data: {
      eventId: event.id,
      dateTime: GAME_DATE,
      status: "played",
      isFriendly: false,
      scoreOne: SCORE_ONE,
      scoreTwo: SCORE_TWO,
      teamOneName: TEAM_ONE,
      teamTwoName: TEAM_TWO,
      teamsSnapshot: snapshotOf(sideOne, sideTwo),
      eloProcessed: false, // Elo approval still pending → the "approve" state
      source: "live",
    },
  });

  // Match Events for the just-ended game.
  for (const g of buildGoals(SCORE_ONE, SCORE_TWO, sideOne, sideTwo, true)) {
    await prisma.matchEvent.create({
      data: {
        gameHistoryId: latest.id,
        type: "goal",
        team: g.team,
        minute: g.minute,
        count: g.count,
        ownGoal: g.ownGoal,
        penalty: g.penalty,
        scorerEventPlayerId: g.scorer.eventPlayerId!,
        scorerName: g.scorer.name,
        assistEventPlayerId: g.assist?.eventPlayerId ?? null,
        assistName: g.assist?.name ?? null,
      },
    });
  }

  // ── Seven earlier counted games (Season history, Rank replay) ──────────────
  const pool = specs.filter((s) => s.role === "starter" || s.role === "bench-played" || s.role === "bench");
  const pattern: Array<"W" | "D" | "L"> = ["W", "W", "L", "W", "W", "D", "W"]; // k = 1..7 weeks ago
  for (let k = 1; k <= 7; k++) {
    const when = new Date(GAME_DATE.getTime() - k * 7 * DAY);
    const others = shuffled(pool.filter((p) => p !== demoSpec)).slice(0, MAX_PLAYERS - 1);
    const lineup = [demoSpec, ...others];
    let [a, b] = balancedSplit(lineup);
    if (!a.includes(demoSpec)) [a, b] = [b, a];
    const r = pattern[k - 1]!;
    const hi = faker.number.int({ min: 5, max: 9 });
    const lo = r === "D" ? hi : faker.number.int({ min: 2, max: hi - 1 });
    const [s1, s2] = r === "W" ? [hi, lo] : r === "L" ? [lo, hi] : [hi, hi];
    const hist = await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: when,
        status: "played",
        isFriendly: false,
        scoreOne: s1,
        scoreTwo: s2,
        teamOneName: TEAM_ONE,
        teamTwoName: TEAM_TWO,
        teamsSnapshot: snapshotOf(a, b),
        paymentsSnapshot: JSON.stringify(lineup.map((p, i) => ({ playerName: p.name, amount: SHARE, status: "paid", method: i % 2 ? "mbway" : "cash" }))),
        eloProcessed: true,
        source: "live",
      },
    });
    const g = await prisma.game.create({
      data: { eventId: event.id, dateTime: when, status: "played", scoreOne: s1, scoreTwo: s2, teamOneName: TEAM_ONE, teamTwoName: TEAM_TWO, eloProcessed: true },
    });
    await prisma.gameParticipant.createMany({
      data: lineup.map((p, i) => ({
        gameId: g.id,
        eventPlayerId: p.eventPlayerId!,
        order: i,
        team: a.includes(p) ? TEAM_ONE : TEAM_TWO,
        slot: (a.includes(p) ? a : b).indexOf(p),
      })),
    });
    if (k <= 3) {
      for (const goal of buildGoals(s1, s2, a, b, false)) {
        await prisma.matchEvent.create({
          data: {
            gameHistoryId: hist.id, type: "goal", team: goal.team, minute: goal.minute, count: goal.count,
            ownGoal: goal.ownGoal, penalty: goal.penalty,
            scorerEventPlayerId: goal.scorer.eventPlayerId!, scorerName: goal.scorer.name,
            assistEventPlayerId: goal.assist?.eventPlayerId ?? null, assistName: goal.assist?.name ?? null,
          },
        });
      }
    }
  }

  // ── Active Season, memberships, two Crews ──────────────────────────────────
  const season = await prisma.season.create({
    data: {
      eventId: event.id,
      name: "Ninjas League — Season 3",
      status: "active",
      registrationOpensAt: new Date(GAME_DATE.getTime() - 9 * 7 * DAY),
      registrationClosesAt: new Date(GAME_DATE.getTime() + 12 * 7 * DAY),
      activatedAt: new Date(GAME_DATE.getTime() - 9 * 7 * DAY),
      createdByUserId: demo.id,
    },
  });
  const members = specs.filter((s) => s.userId && s.role !== "declined");
  const membershipBySpec = new Map<Spec, string>();
  for (const s of members) {
    const m = await prisma.seasonMembership.create({
      data: { seasonId: season.id, eventPlayerId: s.eventPlayerId!, userId: s.userId!, status: "active", joinedAt: season.registrationOpensAt },
    });
    membershipBySpec.set(s, m.id);
  }
  const crewA = await prisma.crew.create({ data: { seasonId: season.id, name: "Kage Crew", sortOrder: 0 } });
  const crewB = await prisma.crew.create({ data: { seasonId: season.id, name: "Shinobi Squad", sortOrder: 1 } });
  const others = members.filter((m) => m !== demoSpec);
  const crewAMembers = [demoSpec, ...others.slice(0, 5)];
  const crewBMembers = others.slice(5, 11); // remaining member stays a free agent
  for (const [crew, list] of [[crewA, crewAMembers], [crewB, crewBMembers]] as const) {
    for (const s of list) {
      await prisma.seasonMembership.update({ where: { id: membershipBySpec.get(s)! }, data: { crewId: crew.id } });
    }
  }
  await prisma.crew.update({ where: { id: crewA.id }, data: { captainMembershipId: membershipBySpec.get(crewAMembers[1]!)! } });
  await prisma.crew.update({ where: { id: crewB.id }, data: { captainMembershipId: membershipBySpec.get(crewBMembers[0]!)! } });

  // ── Cost + per-player payments ─────────────────────────────────────────────
  const eventCost = await prisma.eventCost.create({
    data: {
      eventId: event.id,
      totalAmount: COST_TOTAL,
      currency: "EUR",
      paymentMethods: JSON.stringify([
        { type: "mbway", value: "912000000", label: "MB Way" },
        { type: "revolut_tag", value: "@ninjas-demo", label: "Revolut" },
      ]),
    },
  });
  const others14 = shuffled(played.filter((p) => p !== demoSpec && p !== collectorSpec));
  const plan = new Map<Spec, { status: "paid" | "sent" | "pending"; method: string | null }>();
  plan.set(collectorSpec, { status: "paid", method: "payer" }); // fronted the pitch → auto-settled
  plan.set(demoSpec, { status: "pending", method: null }); // demo owes and has not paid
  const methods = ["cash", "mbway", "revolut"];
  others14.forEach((p, i) => {
    if (i < 8) plan.set(p, { status: "paid", method: methods[i % 3]! });
    else if (i < 11) plan.set(p, { status: "sent", method: "mbway" });
    else plan.set(p, { status: "pending", method: null });
  });
  for (const s of played) {
    const p = plan.get(s)!;
    const paidAt = p.status === "paid" ? new Date(GAME_DATE.getTime() + faker.number.int({ min: 100, max: 400 }) * MIN) : null;
    await prisma.gamePayment.create({
      data: {
        gameId: game.id,
        eventPlayerId: s.eventPlayerId!,
        playerName: s.name,
        amount: SHARE,
        status: p.status,
        method: p.method,
        paidAt,
        markedBy: p.status === "paid" ? collectorSpec.userId : null,
      },
    });
    // Legacy per-event mirror (current-game scoped; cleared on reset).
    await prisma.playerPayment.create({
      data: { eventCostId: eventCost.id, playerName: s.name, amount: SHARE, status: p.status, method: p.method, paidAt, markedBy: p.status === "paid" ? collectorSpec.userId : null },
    });
  }

  // ── MVP voting open: some votes, none from the demo user ───────────────────
  const linkedPlayed = played.filter((p) => p.userId && p !== demoSpec);
  const candidates = [sideOne[1]!, sideTwo[0]!, sideOne[3]!]; // top vote-getters
  const votes: Array<[Spec, Spec]> = [];
  const voters = shuffled(linkedPlayed).slice(0, 6);
  voters.forEach((voter, i) => {
    const target = candidates[i < 3 ? 0 : i < 5 ? 1 : 2]!;
    // No self-votes: swap to another candidate when the voter is the target.
    votes.push([voter, target === voter ? candidates.find((c) => c !== voter && c !== target)! : target]);
  });
  for (const [voter, target] of votes) {
    await prisma.mvpVote.create({
      data: {
        gameHistoryId: latest.id,
        gameId: game.id,
        voterPlayerId: voter.playerId!,
        voterName: voter.name,
        votedForPlayerId: target.playerId!,
        votedForName: target.name,
      },
    });
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  const base = localBase();
  const counts = {
    participants: await prisma.gameParticipant.count({ where: { gameId: game.id } }),
    payments: await prisma.gamePayment.count({ where: { gameId: game.id } }),
    history: await prisma.gameHistory.count({ where: { eventId: event.id } }),
    matchEvents: await prisma.matchEvent.count({ where: { gameHistory: { eventId: event.id } } }),
    mvpVotes: await prisma.mvpVote.count({ where: { gameHistoryId: latest.id } }),
    seasonMembers: members.length,
  };
  console.log("\n✓ Complex post-game prototype seeded");
  console.log(`  Event:        ${event.id}`);
  console.log(`  URL:          ${base}/events/${event.id}`);
  console.log(`  Season:       ${base}/events/${event.id}/seasons/${season.id}`);
  console.log(`  Sign in:      ${DEMO_EMAIL} / demo123  (demo = "${demo.name}", owner + player, team "${TEAM_ONE}")`);
  console.log(`  Teams:        ${TEAM_ONE} avg ${avg(sideOne)} · ${TEAM_TWO} avg ${avg(sideTwo)}  → ${SCORE_ONE}–${SCORE_TWO}`);
  console.log(`  Collector:    ${collectorSpec.name}`);
  console.log(`  Counts:       ${JSON.stringify(counts)}`);
  console.log(`  Played: ${played.length} · bench: ${specs.filter((s) => s.role === "bench").length} · no-show: 1 · declined: 2`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
