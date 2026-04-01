import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { DELETE } from "~/pages/api/events/[id]/purge-player";

vi.mock("~/lib/auth.helpers.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/auth.helpers.server")>("~/lib/auth.helpers.server");
  return {
    ...actual,
    getSession: vi.fn().mockResolvedValue(null),
    checkOwnership: vi.fn().mockResolvedValue({ isOwner: false, isAdmin: false, session: null }),
  };
});

import { checkOwnership } from "~/lib/auth.helpers.server";

function deleteCtx(eventId: string, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params: { id: eventId } } as any;
}

async function seedOwnerAndEvent() {
  await prisma.user.upsert({
    where: { id: "owner-purge" },
    update: {},
    create: { id: "owner-purge", name: "Owner", email: "owner-purge@test.com", emailVerified: true, role: "user", createdAt: new Date(), updatedAt: new Date() },
  });
  await prisma.event.upsert({
    where: { id: "e-purge" },
    update: {},
    create: {
      id: "e-purge", title: "Purge Test", location: "Field",
      dateTime: new Date(Date.now() + 86400000),
      maxPlayers: 10, ownerId: "owner-purge",
      createdAt: new Date(), updatedAt: new Date(),
    },
  });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.playerRating.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await resetApiRateLimitStore();
});

describe("DELETE /api/events/[id]/purge-player", () => {
  it("returns 403 for non-owner/non-admin", async () => {
    await seedOwnerAndEvent();
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);

    const res = await DELETE(deleteCtx("e-purge", { name: "Alice" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when name is missing", async () => {
    await seedOwnerAndEvent();
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: { user: { id: "owner-purge", name: "Owner" } } } as any);

    const res = await DELETE(deleteCtx("e-purge", {}));
    expect(res.status).toBe(400);
  });

  it("removes the Player record", async () => {
    await seedOwnerAndEvent();
    await prisma.player.create({ data: { name: "Alice", eventId: "e-purge", createdAt: new Date() } });
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: { user: { id: "owner-purge", name: "Owner" } } } as any);

    const res = await DELETE(deleteCtx("e-purge", { name: "Alice" }));
    expect(res.status).toBe(200);

    const player = await prisma.player.findFirst({ where: { eventId: "e-purge", name: "Alice" } });
    expect(player).toBeNull();
  });

  it("removes the PlayerRating record", async () => {
    await seedOwnerAndEvent();
    await prisma.playerRating.create({
      data: { eventId: "e-purge", name: "Bob", rating: 1100, gamesPlayed: 5, wins: 3, draws: 1, losses: 1, createdAt: new Date(), updatedAt: new Date() },
    });
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: { user: { id: "owner-purge", name: "Owner" } } } as any);

    const res = await DELETE(deleteCtx("e-purge", { name: "Bob" }));
    expect(res.status).toBe(200);

    const rating = await prisma.playerRating.findFirst({ where: { eventId: "e-purge", name: "Bob" } });
    expect(rating).toBeNull();
  });

  it("scrubs player name from teamsSnapshot JSON", async () => {
    await seedOwnerAndEvent();
    const snapshot = JSON.stringify([
      { team: "A", players: [{ name: "Alice", order: 0 }, { name: "Charlie", order: 1 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }] },
    ]);
    await prisma.gameHistory.create({
      data: {
        eventId: "e-purge", dateTime: new Date(), status: "played",
        teamOneName: "A", teamTwoName: "B",
        teamsSnapshot: snapshot,
        editableUntil: new Date(Date.now() + 86400000),
      },
    });
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: { user: { id: "owner-purge", name: "Owner" } } } as any);

    const res = await DELETE(deleteCtx("e-purge", { name: "Alice" }));
    expect(res.status).toBe(200);

    const history = await prisma.gameHistory.findFirst({ where: { eventId: "e-purge" } });
    const parsed = JSON.parse(history!.teamsSnapshot!);
    const teamA = parsed.find((t: { team: string }) => t.team === "A");
    expect(teamA.players.map((p: { name: string }) => p.name)).not.toContain("Alice");
    expect(teamA.players.map((p: { name: string }) => p.name)).toContain("Charlie");
    // Orders are re-indexed
    expect(teamA.players[0].order).toBe(0);
  });

  it("keeps other players in the snapshot intact", async () => {
    await seedOwnerAndEvent();
    const snapshot = JSON.stringify([
      { team: "A", players: [{ name: "Alice", order: 0 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }, { name: "Charlie", order: 1 }] },
    ]);
    await prisma.gameHistory.create({
      data: {
        eventId: "e-purge", dateTime: new Date(), status: "played",
        teamOneName: "A", teamTwoName: "B",
        teamsSnapshot: snapshot,
        editableUntil: new Date(Date.now() + 86400000),
      },
    });
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: { user: { id: "owner-purge", name: "Owner" } } } as any);

    await DELETE(deleteCtx("e-purge", { name: "Alice" }));

    const history = await prisma.gameHistory.findFirst({ where: { eventId: "e-purge" } });
    const parsed = JSON.parse(history!.teamsSnapshot!);
    const teamB = parsed.find((t: { team: string }) => t.team === "B");
    expect(teamB.players.map((p: { name: string }) => p.name)).toEqual(["Bob", "Charlie"]);
  });
});
