/**
 * The organiser's manual "save teams" path.
 *
 * `assignTeams` used to derive slot numbers from the sport's *default*
 * formation and then force-overwrite BOTH stored `TeamResult.formation` values
 * with that default. A member past the default's slot count was written
 * `slot: null` — a row describing a team the stored formation cannot describe —
 * and a formation the organiser had explicitly picked was silently replaced.
 *
 * The draw has to keep the same invariant as every other membership change:
 * every saved member sits in a slot of the formation the team actually stores,
 * and a stored formation is only defaulted when it does not resolve for the
 * sport. The one honest exception is a team larger than its formation — no
 * formation of a sport has a different slot count, so the surplus stays on the
 * team and is reported `slot: null` rather than fabricated onto a slot that is
 * not there.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { getFormation, getDefaultFormation } from "~/lib/formations";
import { PATCH } from "~/pages/api/events/[id]/teams";

const SPORT = "football-5v5";
const DEFAULT_FORMATION = getDefaultFormation(SPORT).id; // "2-2"
const CHOSEN_FORMATION = "1-2-1"; // also a valid football-5v5 formation
const SLOTS = getFormation(SPORT, CHOSEN_FORMATION)!.slots.length;

function getContext(params: Record<string, string>, body: unknown, headers: Record<string, string> = {}) {
  const url = `http://localhost/api/events/${params.id}/teams`;
  return {
    params,
    request: new Request(url, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    url: new URL(url),
  } as any;
}

const OAUTH_CLIENT_ID = "teams-assign-formation-client";

async function seedEvent() {
  const owner = await prisma.user.create({
    data: {
      id: `owner-${Math.random().toString(36).slice(2, 10)}`,
      name: "Organiser",
      email: `owner-${Math.random().toString(36).slice(2, 10)}@test.com`,
      emailVerified: true,
    },
  });
  await prisma.oauthClient.upsert({
    where: { clientId: OAUTH_CLIENT_ID },
    create: { id: crypto.randomUUID(), name: "Assign Client", clientId: OAUTH_CLIENT_ID, redirectUris: "", type: "web" },
    update: {},
  });
  const accessToken = "assign-formation-token-" + Math.random().toString(36).slice(2);
  await prisma.oauthAccessToken.create({
    data: {
      id: crypto.randomUUID(),
      token: accessToken,
      expiresAt: new Date(Date.now() + 3600_000),
      userId: owner.id,
      clientId: OAUTH_CLIENT_ID,
      scopes: "write:events manage:players",
    },
  });
  const event = await prisma.event.create({
    data: {
      title: "Assign Formation",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86400_000),
      sport: SPORT,
      maxPlayers: 10,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ownerId: owner.id,
    },
  });
  return { event, accessToken };
}

async function seedPlayers(eventId: string, count: number) {
  const players = [];
  for (let i = 0; i < count; i++) {
    players.push(await prisma.player.create({ data: { name: `Player ${i + 1}`, eventId, order: i } }));
  }
  return players;
}

/** A draw already made, every member placed on the stored formation. */
async function seedDrawnTeams(eventId: string, formation: string, split: string[][]) {
  for (const names of split) {
    const team = await prisma.teamResult.create({ data: { name: names === split[0] ? "Ninjas" : "Gunas", eventId, formation } });
    for (let i = 0; i < names.length; i++) {
      await prisma.teamMember.create({ data: { name: names[i], order: i, slot: i, teamResultId: team.id } });
    }
  }
}

async function loadTeams(eventId: string) {
  return prisma.teamResult.findMany({
    where: { eventId },
    include: { members: { orderBy: { order: "asc" } } },
  });
}

beforeEach(async () => {
  resetApiRateLimitStore();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.oauthAccessToken.deleteMany();
  await prisma.oauthClient.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("manual save keeps the draw coherent", () => {
  it("puts every saved member in a slot of the formation the organiser chose, not the sport default", async () => {
    const { event, accessToken } = await seedEvent();
    // Ten live players saved across two five-slot formations: the save carries
    // more members than any single formation has slots.
    const players = await seedPlayers(event.id, 10);
    await seedDrawnTeams(event.id, CHOSEN_FORMATION, [
      ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5"],
      ["Player 6", "Player 7", "Player 8", "Player 9", "Player 10"],
    ]);
    expect(CHOSEN_FORMATION).not.toBe(DEFAULT_FORMATION);

    const res = await PATCH(
      getContext(
        { id: event.id },
        {
          teamOnePlayerIds: players.slice(0, 5).map((p) => p.id),
          teamTwoPlayerIds: players.slice(5).map((p) => p.id),
        },
        { authorization: `Bearer ${accessToken}` },
      ),
    );
    expect(res.status).toBe(200);

    const teams = await loadTeams(event.id);
    expect(teams).toHaveLength(2);
    expect(teams.flatMap((t) => t.members)).toHaveLength(10);

    // Every member sits in a slot of the stored formation — nobody left out.
    for (const team of teams) {
      const slots = team.members.map((m) => m.slot);
      expect(slots, `team ${team.name} slots`).toEqual([0, 1, 2, 3, 4]);
      for (const slot of slots) {
        expect(typeof slot).toBe("number");
        expect(slot!).toBeGreaterThanOrEqual(0);
        expect(slot!).toBeLessThan(SLOTS);
      }
    }

    // The label still names a formation of this sport, and it is the one the
    // organiser picked — not the sport default stamped over it.
    for (const team of teams) {
      expect(getFormation(SPORT, team.formation), `team ${team.name} formation ${team.formation}`).toBeDefined();
      expect(team.formation).toBe(CHOSEN_FORMATION);
    }
  });

  it("leaves a team larger than its stored formation honestly unplaced", async () => {
    const { event, accessToken } = await seedEvent();
    const players = await seedPlayers(event.id, 10);
    await seedDrawnTeams(event.id, CHOSEN_FORMATION, [
      ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5"],
      ["Player 6", "Player 7", "Player 8", "Player 9", "Player 10"],
    ]);

    // Six members onto one five-slot formation: no formation of this sport has
    // a different slot count, so a team genuinely larger than its formation
    // cannot have everyone placed. The surplus must stay on the team and be
    // reported unplaced — never fabricated onto a slot that is not there, and
    // never dropped to keep every row placed.
    const res = await PATCH(
      getContext(
        { id: event.id },
        {
          teamOnePlayerIds: players.slice(0, 6).map((p) => p.id),
          teamTwoPlayerIds: players.slice(6).map((p) => p.id),
        },
        { authorization: `Bearer ${accessToken}` },
      ),
    );
    expect(res.status).toBe(200);
    expect(6).toBeGreaterThan(SLOTS);

    const teams = await loadTeams(event.id);
    // Nobody is dropped from the save.
    expect(teams.flatMap((t) => t.members)).toHaveLength(10);

    const oversubscribed = teams.find((t) => t.members.length === 6)!;
    expect(oversubscribed.members).toHaveLength(6);

    // Every member except the surplus sits in a distinct slot of the stored
    // formation — the whole formation is used, no slot twice, none invented.
    const placed = oversubscribed.members.filter((m) => m.slot !== null);
    expect(placed).toHaveLength(SLOTS);
    expect(placed.map((m) => m.slot)).toEqual([0, 1, 2, 3, 4]);

    // The surplus is the one member the formation cannot describe.
    const surplus = oversubscribed.members.filter((m) => m.slot === null);
    expect(surplus).toHaveLength(1);
    expect(surplus[0].slot).toBeNull();
    expect(surplus[0].name).toBe("Player 6");

    // The other team still fits its formation, so nobody there is unplaced.
    const fitted = teams.find((t) => t.members.length === 4)!;
    expect(fitted.members.every((m) => m.slot !== null)).toBe(true);
    expect(fitted.members.map((m) => m.slot)).toEqual([0, 1, 2, 3]);

    // The stored formation is still the organiser's choice, not the default.
    for (const team of teams) {
      expect(team.formation).toBe(CHOSEN_FORMATION);
      expect(getFormation(SPORT, team.formation)).toBeDefined();
    }
  });

  it("defaults the stored formation only when it does not resolve for the sport", async () => {
    const { event, accessToken } = await seedEvent();
    const players = await seedPlayers(event.id, 10);
    // A formation id from another sport: it cannot label this draw, so the
    // sport default is the right stored value.
    await seedDrawnTeams(event.id, "4-4-2", [
      ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5"],
      ["Player 6", "Player 7", "Player 8", "Player 9", "Player 10"],
    ]);

    const res = await PATCH(
      getContext(
        { id: event.id },
        {
          teamOnePlayerIds: players.slice(0, 5).map((p) => p.id),
          teamTwoPlayerIds: players.slice(5).map((p) => p.id),
        },
        { authorization: `Bearer ${accessToken}` },
      ),
    );
    expect(res.status).toBe(200);

    const teams = await loadTeams(event.id);
    for (const team of teams) {
      expect(team.formation).toBe(DEFAULT_FORMATION);
      expect(new Set(team.members.map((m) => m.slot))).toEqual(new Set([0, 1, 2, 3, 4]));
    }
  });
});
