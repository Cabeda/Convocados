/**
 * GH-1401 — capacity converges on the Roster module (web surfaces + write routes).
 * The Event page, Roster list, cost, payments, team assignment, randomize and the
 * MCP write tools all used to re-slice `slice(0, maxPlayers)` inline. ADR 0016:
 * the current Game's GameParticipant rows are the authoritative Roster; the legacy
 * `Player` rows accumulate across an Event's Games and inflate any capacity read.
 *
 * Every test below seeds the SAME shape — a recurring Event past its first Game,
 * 8 spots, 10 accumulated legacy rows, 2 players on the current Game's Roster — so
 * the one answer every surface must give is those 2 players and nobody from the
 * churn. A surface still reading the legacy rows answers with 8 churn names.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { setEventCost } from "~/lib/eventCost.server";
import { syncPaymentsForEvent } from "~/lib/payments.server";
import { getSession } from "~/lib/auth.helpers.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { seedRecurringEvent, addGameParticipant, clearRosterTables } from "./helpers/rosterFixtures";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn().mockResolvedValue({ isOwner: true, isAdmin: false, session: { user: { id: "organiser" } } }),
}));

vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
  drainNotificationQueue: vi.fn().mockResolvedValue(0),
}));

vi.mock("~/lib/webhook.server", () => ({ fireWebhooks: vi.fn().mockResolvedValue(undefined) }));

const { enqueueNotification } = await import("~/lib/notificationQueue.server");

const MAX_PLAYERS = 8;
const ROSTER = ["Player 1", "Player 2"];
const CHURNED_IN = 10;

/** A recurring Event whose Roster has rolled on from its first Game to the next. */
async function seedEventWithChurn(rosterSize = ROSTER.length) {
  const event = await seedRecurringEvent(MAX_PLAYERS);
  // Legacy Player rows accumulate across the Event's past Games (ADR 0016).
  await prisma.player.createMany({
    data: Array.from({ length: CHURNED_IN }, (_, i) => ({ eventId: event.id, name: `Churn ${i}`, order: i })),
  });
  for (let i = 0; i < rosterSize; i++) {
    await addGameParticipant(event.currentGameId!, event.id, `Player ${i + 1}`, i);
  }
  return event;
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetApiRateLimitStore();
  vi.mocked(getSession).mockResolvedValue({ user: { id: "organiser", name: "Organiser" } } as any);
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.playerPayment.deleteMany();
  await clearRosterTables();
});

function routeContext(eventId: string, method: string, body?: unknown) {
  return {
    params: { id: eventId },
    url: new URL(`http://localhost/api/events/${eventId}/teams`),
    request: new Request(`http://localhost/api/events/${eventId}/teams`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  } as any;
}

/** Every name the teams surface is willing to draw, active spots and bench alike. */
async function drawnNames() {
  const members = await prisma.teamMember.findMany({ select: { name: true } });
  return members.map((m) => m.name).sort();
}

describe("setEventCost — the cost surface", () => {
  it("bills the current Game's Roster, not the legacy rows the past Games left behind", async () => {
    const event = await seedEventWithChurn();

    const result = await setEventCost(event.id, { totalAmount: 80 });

    // 8 spots, 80€ split over the required playing slots — 10€ per active player.
    expect(result.payments.map((p) => p.playerName)).toEqual(ROSTER);
    expect(result.payments.map((p) => p.amount)).toEqual([10, 10]);
  });

  it("keeps the bench off the bill", async () => {
    const event = await seedEventWithChurn(MAX_PLAYERS + 1);

    const result = await setEventCost(event.id, { totalAmount: 80 });

    expect(result.payments).toHaveLength(MAX_PLAYERS);
    expect(result.payments.some((p) => p.playerName === `Player ${MAX_PLAYERS + 1}`)).toBe(false);
  });
});

describe("syncPaymentsForEvent — the payments surface", () => {
  it("keeps a payment row only for a player on the current Game's Roster", async () => {
    const event = await seedEventWithChurn();
    await prisma.eventCost.create({ data: { eventId: event.id, totalAmount: 80, currency: "EUR" } });

    await syncPaymentsForEvent(event.id);

    const rows = await prisma.playerPayment.findMany({ orderBy: { playerName: "asc" } });
    expect(rows.map((r) => r.playerName)).toEqual(ROSTER);
  });
});

describe("teams route — the team assignment surface", () => {
  it("splits the current Game's Roster into active spots and bench", async () => {
    const event = await seedEventWithChurn(MAX_PLAYERS + 2);
    const { GET } = await import("~/pages/api/events/[id]/teams");

    const res = await GET(routeContext(event.id, "GET"));
    const body = await res.json();

    expect([...body.unassigned, ...body.bench].map((p: { name: string }) => p.name).sort()).toEqual(
      Array.from({ length: MAX_PLAYERS + 2 }, (_, i) => `Player ${i + 1}`).sort(),
    );
    expect(body.bench.map((p: { name: string }) => p.name)).toEqual([`Player ${MAX_PLAYERS + 1}`, `Player ${MAX_PLAYERS + 2}`]);
    expect(body.maxPlayers).toBe(MAX_PLAYERS);
  });

  it("refuses to write a player the current Game's Roster does not have", async () => {
    const event = await seedEventWithChurn();
    const churn = await prisma.player.findFirstOrThrow({ where: { eventId: event.id, name: "Churn 0" } });
    const { PUT } = await import("~/pages/api/events/[id]/teams");

    const res = await PUT(
      routeContext(event.id, "PUT", {
        matches: [{ team: "Red", players: [{ name: "Player 1", order: 0 }] }, { team: "Blue", players: [{ name: "Churn 0", order: 1 }] }],
      }),
    );

    expect(res.status).toBe(400);
    expect(await drawnNames()).toEqual([]);
    expect(churn.id).toBeTruthy();
  });
});

describe("assignTeams — the MCP set_teams write tool", () => {
  it("draws the active spots out of the current Game's Roster only", async () => {
    const event = await seedEventWithChurn();
    const eps = await prisma.eventPlayer.findMany({ where: { eventId: event.id }, orderBy: { name: "asc" } });
    const { assignTeams } = await import("~/lib/teamAssignment.server");

    const result = await assignTeams(
      event.id,
      { teamOnePlayerIds: [eps[0].id], teamTwoPlayerIds: [eps[1].id] },
      MAX_PLAYERS,
      event.currentGameId,
      "football-5v5",
    );

    expect([...result.teamOne.members, ...result.teamTwo.members].map((m) => m.name).sort()).toEqual(ROSTER);
  });

  it("rejects a legacy Player row the current Game's Roster never had", async () => {
    const event = await seedEventWithChurn();
    const churn = await prisma.player.findFirstOrThrow({ where: { eventId: event.id, name: "Churn 0" } });
    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: event.id, name: "Player 1" } });
    const { assignTeams } = await import("~/lib/teamAssignment.server");

    await expect(
      assignTeams(event.id, { teamOnePlayerIds: [ep.id], teamTwoPlayerIds: [churn.id] }, MAX_PLAYERS, event.currentGameId, "football-5v5"),
    ).rejects.toThrow("not found in event");
  });
});

describe("randomize route — the write route", () => {
  it("draws from the current Game's Roster and no one from the churn", async () => {
    const event = await seedEventWithChurn();
    const { POST } = await import("~/pages/api/events/[id]/randomize");

    const res = await POST({ ...routeContext(event.id, "POST"), url: new URL("http://localhost/?balanced=false") });
    expect(res.status).toBe(200);
    expect(await drawnNames()).toEqual(ROSTER);
  });
});

describe("status route — the Event page payload", () => {
  it("reports the Roster's active spots, bench and remaining capacity", async () => {
    const event = await seedEventWithChurn(MAX_PLAYERS + 1);
    const { GET } = await import("~/pages/api/events/[id]/status");

    const body = await (await GET(routeContext(event.id, "GET"))).json();

    expect(body.players.active.map((p: { name: string }) => p.name)).toEqual(
      Array.from({ length: MAX_PLAYERS }, (_, i) => `Player ${i + 1}`),
    );
    expect(body.players.bench.map((p: { name: string }) => p.name)).toEqual([`Player ${MAX_PLAYERS + 1}`]);
    expect(body.players.total).toBe(MAX_PLAYERS + 1);
    expect(body.players.spotsLeft).toBe(0);
  });
});

describe("reschedule routes — the spotsLeft the notification carries", () => {
  /** Every `event_details` notification queued in this test, whatever its arity. */
  function queuedSpotsLeft() {
    return vi
      .mocked(enqueueNotification)
      .mock.calls.filter((call) => call[1] === "event_details")
      .map((call) => (call[2] as { spotsLeft: number }).spotsLeft);
  }

  it("notifies with the current Game's remaining capacity on a court switch", async () => {
    const event = await seedEventWithChurn();
    const { POST } = await import("~/pages/api/events/[id]/switch-court");

    await POST(routeContext(event.id, "POST", { location: "Court 2" }));

    expect(queuedSpotsLeft()).toEqual([MAX_PLAYERS - ROSTER.length]);
  });

  it("notifies with the current Game's remaining capacity on a date change", async () => {
    const event = await seedEventWithChurn();
    const { PUT } = await import("~/pages/api/events/[id]/datetime");

    await PUT(routeContext(event.id, "PUT", { dateTime: new Date(Date.now() + 3 * 86400_000).toISOString() }));

    expect(queuedSpotsLeft()).toEqual([MAX_PLAYERS - ROSTER.length]);
  });
});