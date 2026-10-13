/**
 * Team randomize trigger contract (prod repro: event cmmkfrx8b0000o2ixrix1yp2m).
 *
 * Expected triggers:
 *  1. Manual randomize button (covered elsewhere: POST /randomize).
 *  2. Auto-randomize when the roster reaches maxPlayers — including on a NEW
 *     occurrence after a recurrence reset.
 *  3. Leave at full + bench replacement keeps teams full; a re-add after a
 *     leave must put the leaver back onto the teams.
 *
 * Prod bugs reproduced here:
 *  - After a recurrence reset the empty TeamResult shells persist in the DB
 *    (non-destructive reset by design). addPlayerToTeams treated them as live
 *    teams, so the FIRST joiner of the new occurrence immediately materialised
 *    teams (symptom: "teams generated before we reached the min players"),
 *    while autoRandomizeIfFull's `existingTeams > 0` guard saw the same shells
 *    and never drew at maxPlayers (symptom: "reaching the number doesn't run").
 *  - Re-adding a leaver whose join payload name ("Cabeda") differs from the
 *    canonical EventPlayer name ("José Cabeda") skipped team placement:
 *    addPlayerToTeams checks activeNames.has(trimmed) with the payload name.
 *  - The re-join-after-leave branch (Player active + GameParticipant archived)
 *    returned without any team sync or auto-randomize.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST } from "~/pages/api/events/[id]/players";
import { getSession } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { archiveAndLeave } from "~/lib/leave.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
}));

vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/random", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/random")>();
  return { ...actual, Randomize: vi.fn(actual.Randomize) };
});

import { Randomize } from "~/lib/random";
const mockRandomize = vi.mocked(Randomize);

const mockGetSession = vi.mocked(getSession);

function ctx(eventId: string, body: any, session: { user: { id: string; name: string } } | null) {
  mockGetSession.mockResolvedValue(session as any);
  return {
    params: { id: eventId },
    request: new Request(`http://localhost/api/events/${eventId}/players`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-id": "test-client" },
      body: JSON.stringify(body),
    }),
  } as any;
}

/** Recurring event with a current Game — ADR 0016 game-scoped roster. */
async function seedRecurringEvent(maxPlayers = 4, balanced = false) {
  const event = await prisma.event.create({
    data: {
      title: "Ninjas da Areosa",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers,
      balanced,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      isRecurring: true,
      recurrenceRule: "FREQ=WEEKLY",
    },
  });
  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: event.dateTime, status: "upcoming" },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id };
}

async function seedUser(name: string, id: string) {
  return prisma.user.create({
    data: { id, name, email: `${id}@t.com`, emailVerified: true },
  });
}

async function join(eventId: string, name: string, session: { user: { id: string; name: string } } | null = null) {
  return POST(ctx(eventId, session ? { name, linkToAccount: true } : { name }, session));
}

async function teamMembers(eventId: string) {
  const teams = await prisma.teamResult.findMany({
    where: { eventId },
    include: { members: true },
  });
  return {
    teams,
    names: teams.flatMap((t) => t.members.map((m) => m.name)).sort(),
    total: teams.reduce((sum, t) => sum + t.members.length, 0),
  };
}

beforeEach(async () => {
  await prisma.rsvp.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

describe("auto-randomize triggers", () => {
  it("does not materialise teams from empty TeamResult shells before maxPlayers", async () => {
    // Post-recurrence-reset state: advanceOccurrence clears teamMembers but
    // keeps the empty TeamResult rows (non-destructive reset, #game-occurrence).
    const event = await seedRecurringEvent(4);
    await prisma.teamResult.createMany({
      data: [
        { eventId: event.id, name: "Ninjas" },
        { eventId: event.id, name: "Gunas" },
      ],
    });

    const res = await join(event.id, "P1");
    expect(res.status).toBe(200);

    const { total } = await teamMembers(event.id);
    expect(total).toBe(0);
  });

  it("auto-randomises at maxPlayers even when empty TeamResult shells exist", async () => {
    const event = await seedRecurringEvent(4);
    await prisma.teamResult.createMany({
      data: [
        { eventId: event.id, name: "Ninjas" },
        { eventId: event.id, name: "Gunas" },
      ],
    });

    await join(event.id, "P1");
    await join(event.id, "P2");
    await join(event.id, "P3");
    // Not full yet — teams must not exist as populated draws.
    expect((await teamMembers(event.id)).total).toBe(0);

    const res = await join(event.id, "P4");
    expect(res.status).toBe(200);

    const { teams, names, total } = await teamMembers(event.id);
    expect(teams).toHaveLength(2);
    expect(total).toBe(4);
    expect(names).toEqual(["P1", "P2", "P3", "P4"]);
  });

  it("re-adding a leaver under a different display name puts them back on the teams", async () => {
    // Prod: user's canonical EventPlayer name is "José Cabeda"; the re-add
    // payload carried "Cabeda". The join succeeded but team placement was
    // skipped (activeNames keyed on canonical names) → final draw was 4v5.
    const user = await seedUser("José Cabeda", "u-jose");
    const event = await seedRecurringEvent(4);

    await join(event.id, "P1");
    await join(event.id, "P2");
    await join(event.id, "P3");
    const full = await join(event.id, "José Cabeda", { user: { id: user.id, name: user.name } });
    expect(full.status).toBe(200);

    const afterFull = await teamMembers(event.id);
    expect(afterFull.total).toBe(4);

    // José leaves (10→9 in prod): teams shrink by one.
    const player = await prisma.player.findFirstOrThrow({
      where: { eventId: event.id, name: "José Cabeda" },
    });
    await archiveAndLeave({
      eventId: event.id,
      playerId: player.id,
      actor: { kind: "self", userId: user.id },
    });
    expect((await teamMembers(event.id)).total).toBe(3);

    // José re-adds himself under the shorter name.
    const res = await join(event.id, "Cabeda", { user: { id: user.id, name: user.name } });
    expect(res.status).toBe(200);

    const afterReadd = await teamMembers(event.id);
    expect(afterReadd.total).toBe(4);
    expect(afterReadd.names).toContain("José Cabeda");
  });

  it("re-join after leave (Player active, GameParticipant archived) auto-randomises at maxPlayers", async () => {
    // Prod #1237 state: a prior re-add un-archived the Player row but the
    // GameParticipant stayed archived. The re-join branch must sync teams too.
    const user = await seedUser("Rodrigo Stange", "u-rodrigo");
    const event = await seedRecurringEvent(4);

    await join(event.id, "P1");
    await join(event.id, "P2");
    await join(event.id, "P3");

    // Rodrigo: Player row active, EventPlayer + archived GameParticipant.
    const player = await prisma.player.create({
      data: { eventId: event.id, name: "Rodrigo Stange", userId: user.id, order: 3 },
    });
    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "Rodrigo Stange", userId: user.id },
    });
    await prisma.gameParticipant.create({
      data: {
        gameId: event.currentGameId!,
        eventPlayerId: ep.id,
        order: 3,
        archivedAt: new Date(Date.now() - 3600_000),
      },
    });
    expect(player.id).toBeTruthy();

    const res = await join(event.id, "Rodrigo Stange", { user: { id: user.id, name: user.name } });
    expect(res.status).toBe(200);

    // Roster hit maxPlayers via the re-join branch → teams must be drawn.
    const { teams, names, total } = await teamMembers(event.id);
    expect(teams).toHaveLength(2);
    expect(total).toBe(4);
    expect(names).toEqual(["P1", "P2", "P3", "Rodrigo Stange"]);
  });

  it("leave at full with a bench player keeps teams full via promotion", async () => {
    // Expectation 3: full game, one leaves, bench player replaces them.
    const user = await seedUser("Leaver", "u-leaver");
    const event = await seedRecurringEvent(4);

    await join(event.id, "P1");
    await join(event.id, "P2");
    await join(event.id, "P3");
    await join(event.id, "Leaver", { user: { id: user.id, name: user.name } });
    await join(event.id, "Bench Guy"); // bench — 5th player

    expect((await teamMembers(event.id)).total).toBe(4);

    const player = await prisma.player.findFirstOrThrow({
      where: { eventId: event.id, name: "Leaver" },
    });
    await archiveAndLeave({
      eventId: event.id,
      playerId: player.id,
      actor: { kind: "self", userId: user.id },
    });

    const after = await teamMembers(event.id);
    expect(after.total).toBe(4);
    expect(after.names).toContain("Bench Guy");
    expect(after.names).not.toContain("Leaver");
  });

  it("bench promotion on a non-balanced event re-runs the random draw", async () => {
    // Agreed improvement: full game, one leaves, bench replaces → the draw is
    // re-run (not just slot-filled) so the late change is reflected fairly.
    const user = await seedUser("Leaver", "u-leaver");
    const event = await seedRecurringEvent(4); // balanced=false by default

    await join(event.id, "P1");
    await join(event.id, "P2");
    await join(event.id, "P3");
    await join(event.id, "Leaver", { user: { id: user.id, name: user.name } });
    await join(event.id, "Bench Guy");
    expect((await teamMembers(event.id)).total).toBe(4);

    mockRandomize.mockClear();

    const player = await prisma.player.findFirstOrThrow({
      where: { eventId: event.id, name: "Leaver" },
    });
    await archiveAndLeave({
      eventId: event.id,
      playerId: player.id,
      actor: { kind: "self", userId: user.id },
    });

    expect(mockRandomize).toHaveBeenCalledTimes(1);
    const [drawnNames] = mockRandomize.mock.calls[0];
    expect([...drawnNames].sort()).toEqual(["Bench Guy", "P1", "P2", "P3"]);

    const after = await teamMembers(event.id);
    expect(after.total).toBe(4);
    expect(after.names).toContain("Bench Guy");
    expect(after.names).not.toContain("Leaver");
  });

  it("leave before the roster is full must not materialise teams from empty shells (balanced)", async () => {
    // Prod cmmkfrx8b0000o2ixrix1yp2m (2026-10-13 10:56): a balanced recurring
    // event with empty TeamResult shells. A self-leave ran removePlayerFromTeams,
    // whose balanced branch calls rebalanceTeams — which DRAWS the remaining
    // players, materialising teams at 7/10. The leaver's immediate re-join then
    // rebalanced the 7 back in, so "joining" appeared to generate teams.
    const user = await seedUser("José Cabeda", "u-jose");
    const event = await seedRecurringEvent(10, true);
    await prisma.teamResult.createMany({
      data: [
        { eventId: event.id, name: "Ninjas" },
        { eventId: event.id, name: "Gunas" },
      ],
    });

    await join(event.id, "P1");
    await join(event.id, "P2");
    await join(event.id, "P3");
    await join(event.id, "José Cabeda", { user: { id: user.id, name: user.name } });

    const player = await prisma.player.findFirstOrThrow({
      where: { eventId: event.id, name: "José Cabeda" },
    });
    await archiveAndLeave({
      eventId: event.id,
      playerId: player.id,
      actor: { kind: "self", userId: user.id },
    });

    // Roster is 3/10 — no draw has been earned, so no teams may exist.
    const after = await teamMembers(event.id);
    expect(after.total).toBe(0);
  });
});
