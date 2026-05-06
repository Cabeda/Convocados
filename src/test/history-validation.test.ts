import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST } from "~/pages/api/events/[id]/history/index";
import { checkOwnership, getSession } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

vi.mock("~/lib/eventLog.server", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

const mockCheckOwnership = vi.mocked(checkOwnership);
const mockGetSession = vi.mocked(getSession);

beforeEach(async () => {
  await prisma.gameHistory.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ user: { id: "u1", name: "Owner" } } as any);
  mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: { user: { id: "u1", name: "Owner" } } } as any);
});

function ctx(eventId: string, body: any) {
  return {
    params: { id: eventId },
    request: new Request(`http://localhost/api/events/${eventId}/history`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as any;
}

describe("POST /api/events/[id]/history — validation", () => {
  it("returns 404 when event not found", async () => {
    const res = await POST(ctx("nonexistent", {}));
    expect(res.status).toBe(404);
  });

  it("returns 403 when not owner or admin", async () => {
    const user = await prisma.user.create({
      data: { id: "owner1", name: "Owner", email: "o@t.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: { title: "Game", location: "L", dateTime: new Date(), maxPlayers: 10, ownerId: user.id },
    });
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false } as any);
    const res = await POST(ctx(event.id, {}));
    expect(res.status).toBe(403);
  });

  it("returns 400 when required fields are missing", async () => {
    const event = await prisma.event.create({
      data: { title: "Game", location: "L", dateTime: new Date(), maxPlayers: 10 },
    });
    const res = await POST(ctx(event.id, { teamOneName: "A" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when teamsSnapshot has wrong number of teams", async () => {
    const event = await prisma.event.create({
      data: { title: "Game", location: "L", dateTime: new Date(), maxPlayers: 10 },
    });
    const res = await POST(ctx(event.id, {
      dateTime: new Date().toISOString(),
      teamOneName: "A", teamTwoName: "B",
      scoreOne: 1, scoreTwo: 0,
      teamsSnapshot: [{ team: "A", players: [] }], // only 1 team
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("exactly 2 teams");
  });

  it("returns 400 when teamsSnapshot has invalid structure", async () => {
    const event = await prisma.event.create({
      data: { title: "Game", location: "L", dateTime: new Date(), maxPlayers: 10 },
    });
    const res = await POST(ctx(event.id, {
      dateTime: new Date().toISOString(),
      teamOneName: "A", teamTwoName: "B",
      scoreOne: 1, scoreTwo: 0,
      teamsSnapshot: [{ team: "", players: [] }, { players: "invalid" }], // invalid structure
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid teamsSnapshot");
  });

  it("creates history entry with valid data", async () => {
    const event = await prisma.event.create({
      data: { title: "Game", location: "L", dateTime: new Date(), maxPlayers: 10 },
    });
    const res = await POST(ctx(event.id, {
      dateTime: new Date().toISOString(),
      teamOneName: "Team A", teamTwoName: "Team B",
      scoreOne: 2, scoreTwo: 1,
      teamsSnapshot: [
        { team: "Team A", players: [{ name: "P1", order: 0 }] },
        { team: "Team B", players: [{ name: "P2", order: 0 }] },
      ],
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
  });
});
