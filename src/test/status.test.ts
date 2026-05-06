import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET } from "~/pages/api/events/[id]/status";
import { getSession, checkEventAdmin } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/auth.helpers.server")>("~/lib/auth.helpers.server");
  return {
    ...actual,
    getSession: vi.fn(),
    checkEventAdmin: vi.fn(),
  };
});

beforeEach(async () => {
  await prisma.player.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

function ctx(eventId: string, cookie?: string) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/status`, {
      headers: cookie ? { cookie } : {},
    }),
    params: { id: eventId },
    url: new URL(`http://localhost/api/events/${eventId}/status`),
  } as any;
}

async function seedUser(id = "user-status-1") {
  return prisma.user.create({
    data: { id, name: "Status User", email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent(overrides: Partial<{ ownerId: string; accessPassword: string }> = {}, id = "evt-status-1") {
  return prisma.event.create({
    data: {
      id,
      title: "Status Game",
      location: "Pitch",
      dateTime: new Date("2024-07-15T19:00:00Z"),
      maxPlayers: 10,
      ownerId: overrides.ownerId ?? null,
      accessPassword: overrides.accessPassword ?? null,
    },
  });
}

describe("GET /api/events/[id]/status", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await GET(ctx("non-existent"));
    expect(res.status).toBe(404);
  });

  it("returns event status for public event", async () => {
    const event = await seedEvent();
    await prisma.player.create({
      data: { name: "Player1", eventId: event.id, order: 0 },
    });

    const res = await GET(ctx(event.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(event.id);
    expect(body.players.active).toHaveLength(1);
    expect(body.players.spotsLeft).toBe(9);
  });

  it("returns locked response for password-protected event without access", async () => {
    const event = await seedEvent({ accessPassword: "hashed-password" });

    vi.mocked(getSession).mockResolvedValue(null);

    const res = await GET(ctx(event.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locked).toBe(true);
    expect(body.hasPassword).toBe(true);
  });

  it("returns full event for password-protected event with valid session", async () => {
    const user = await seedUser();
    const event = await seedEvent({ ownerId: user.id, accessPassword: "hashed-password" });

    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    vi.mocked(checkEventAdmin).mockResolvedValue(false);

    const res = await GET(ctx(event.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locked).toBeUndefined();
    expect(body.id).toBe(event.id);
  });

  it("handles bench players correctly", async () => {
    const event = await seedEvent({}, "evt-bench");
    event.maxPlayers = 2;
    await prisma.event.update({ where: { id: event.id }, data: { maxPlayers: 2 } });

    await prisma.player.createMany({
      data: [
        { name: "P1", eventId: event.id, order: 0 },
        { name: "P2", eventId: event.id, order: 1 },
        { name: "P3", eventId: event.id, order: 2 },
      ],
    });

    const res = await GET(ctx(event.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.players.active).toHaveLength(2);
    expect(body.players.bench).toHaveLength(1);
    expect(body.players.spotsLeft).toBe(0);
  });

  it("includes team results", async () => {
    const event = await seedEvent({}, "evt-teams");
    await prisma.player.create({ data: { name: "P1", eventId: event.id, order: 0 } });
    const team = await prisma.teamResult.create({
      data: { eventId: event.id, name: "Team A" },
    });
    await prisma.teamMember.create({
      data: { teamResultId: team.id, name: "P1", order: 0 },
    });

    const res = await GET(ctx(event.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].name).toBe("Team A");
  });
});
