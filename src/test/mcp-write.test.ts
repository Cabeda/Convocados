import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: vi.fn(),
  requireScope: vi.fn((ctx: any, scope: string) => {
    if (ctx.scopes.includes("*")) return true;
    return ctx.scopes.includes(scope);
  }),
}));
vi.mock("~/lib/apiRateLimit.server", async (importOriginal) => {
  const orig = (await importOriginal()) as any;
  return { ...orig, checkApiRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })), extractIp: () => "127.0.0.1" };
});

import { authenticateRequest } from "~/lib/authenticate.server";
const { POST } = await import("~/pages/api/mcp");
const mockAuth = vi.mocked(authenticateRequest);
const PROTOCOL = "2026-07-28";

function makeRequest(body: any, headers: Record<string, string> = {}) {
  return new Request("http://localhost:4321/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
function ctx(req: Request) {
  return { request: req } as any;
}
function callTool(name: string, args: Record<string, unknown>) {
  return makeRequest(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    { "MCP-Protocol-Version": PROTOCOL, "Mcp-Method": "tools/call", "Mcp-Name": name }
  );
}

async function createOwner() {
  return prisma.user.create({ data: { id: `mcpw-${crypto.randomUUID().slice(0, 8)}`, name: "Owner", email: `mcpw-${crypto.randomUUID().slice(0, 8)}@test.com`, emailVerified: true } });
}

async function createEvent(ownerId: string, overrides: Record<string, unknown> = {}) {
  const event = await prisma.event.create({
    data: {
      title: "Write Event",
      location: "Lisbon",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers: 10,
      ownerId,
      ...overrides,
    },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime } });
  return prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
}

async function addActivePlayer(eventId: string, gameId: string, name: string, order = 0) {
  const ep = await prisma.eventPlayer.create({ data: { eventId, name } });
  await prisma.gameParticipant.create({ data: { gameId, eventPlayerId: ep.id, order } });
  return prisma.player.create({ data: { eventId, name, order } });
}

beforeEach(async () => {
  await prisma.gamePayment.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.playerInvite.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.game.deleteMany();
  await prisma.event.deleteMany();
  await prisma.$executeRawUnsafe("DELETE FROM oauthAccessToken");
  await prisma.user.deleteMany();
  vi.clearAllMocks();
});

describe("MCP write tools — create_event", () => {
  it("creates an event with its first game when scoped create:events", async () => {
    const owner = await createOwner();
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["create:events"], authMethod: "oauth", clientId: "c1" });
    const future = new Date(Date.now() + 86400_000).toISOString();
    const res = await POST(ctx(callTool("convocados_create_event", { title: "Agent Game", dateTime: future, location: "Porto", maxPlayers: 8, sport: "padel" })));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    expect(data.id).toBeTruthy();
    const event = await prisma.event.findUnique({ where: { id: data.id } });
    expect(event?.title).toBe("Agent Game");
    expect(event?.currentGameId).toBeTruthy();
    expect(event?.ownerId).toBe(owner.id);
  });

  it("rejects create_event when scope is missing (403)", async () => {
    const owner = await createOwner();
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["read:events"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_create_event", { title: "X", dateTime: new Date(Date.now() + 86400_000).toISOString() })));
    expect(res.status).toBe(403);
  });

  it("creates a recurring event when isRecurring and recurrenceFreq are set", async () => {
    const owner = await createOwner();
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["create:events"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_create_event", {
      title: "Weekly", dateTime: new Date(Date.now() + 86400_000).toISOString(), isRecurring: true, recurrenceFreq: "weekly", recurrenceInterval: 2,
    })));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    const event = await prisma.event.findUnique({ where: { id: data.id } });
    expect(event?.recurrenceRule).toContain("weekly");
    expect(event?.nextResetAt).toBeTruthy();
  });

  it("rejects an invalid dateTime", async () => {
    const owner = await createOwner();
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["create:events"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_create_event", { title: "X", dateTime: "not-a-date" })));
    expect(res.status).toBe(400);
  });

  it("rejects a past dateTime", async () => {
    const owner = await createOwner();
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["create:events"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_create_event", { title: "X", dateTime: new Date(Date.now() - 86400_000).toISOString() })));
    expect(res.status).toBe(400);
  });

  it("rejects a missing title", async () => {
    const owner = await createOwner();
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["create:events"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_create_event", { dateTime: new Date(Date.now() + 86400_000).toISOString() })));
    expect(res.status).toBe(400);
  });
});

describe("MCP write tools — add_player", () => {
  it("adds a player to the active roster when actor owns the event", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id);
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:players"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_add_player", { eventId: event.id, name: "Alice" })));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    expect(data.ok).toBe(true);
    expect(data.name).toBe("Alice");
    const gp = await prisma.gameParticipant.findFirst({
      where: { gameId: event.currentGameId!, eventPlayer: { name: "Alice" } },
    });
    expect(gp).toBeTruthy();
  });

  it("rejects add_player when actor is neither owner nor admin (403)", async () => {
    const owner = await createOwner();
    const outsider = await prisma.user.create({ data: { id: `mcpw-${crypto.randomUUID().slice(0, 8)}`, name: "Out", email: `mcpw-${crypto.randomUUID().slice(0, 8)}@test.com`, emailVerified: true } });
    const event = await createEvent(owner.id);
    mockAuth.mockResolvedValue({ userId: outsider.id, scopes: ["manage:players"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_add_player", { eventId: event.id, name: "Alice" })));
    expect(res.status).toBe(403);
  });

  it("allows an event admin to add a player", async () => {
    const owner = await createOwner();
    const admin = await prisma.user.create({ data: { id: `mcpw-${crypto.randomUUID().slice(0, 8)}`, name: "Adm", email: `mcpw-${crypto.randomUUID().slice(0, 8)}@test.com`, emailVerified: true } });
    const event = await createEvent(owner.id);
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: admin.id } });
    mockAuth.mockResolvedValue({ userId: admin.id, scopes: ["manage:players"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_add_player", { eventId: event.id, name: "Bob" })));
    expect(res.status).toBe(200);
  });

  it("errors when the event has no current game", async () => {
    const owner = await createOwner();
    const event = await prisma.event.create({ data: { title: "NoGame", location: "Lisbon", dateTime: new Date(Date.now() + 86400_000), maxPlayers: 10, ownerId: owner.id } });
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:players"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_add_player", { eventId: event.id, name: "Alice" })));
    expect(res.status).toBe(400);
  });

  it("errors when the eventId is missing", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["manage:players"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_add_player", { name: "Alice" })));
    const body: any = await res.json();
    expect(body.error.code).toBe(-32602);
  });

  it("returns 404 when the event does not exist", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["manage:players"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_add_player", { eventId: "missing", name: "Alice" })));
    expect(res.status).toBe(404);
  });

  it("rejects when the bench is full", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id, { maxPlayers: 2 });
    for (const [i, name] of ["A", "B", "C", "D"].entries()) {
      await addActivePlayer(event.id, event.currentGameId!, name, i);
    }
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:players"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_add_player", { eventId: event.id, name: "E" })));
    expect(res.status).toBe(400);
  });

  it("rejects when the game has already ended", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id, { dateTime: new Date(Date.now() - 86400_000) });
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:players"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_add_player", { eventId: event.id, name: "Alice" })));
    expect(res.status).toBe(403);
  });

  it("adds a registered user by userId and auto-follows", async () => {
    const owner = await createOwner();
    const member = await prisma.user.create({ data: { id: `mcpw-${crypto.randomUUID().slice(0, 8)}`, name: "Member", email: `mcpw-${crypto.randomUUID().slice(0, 8)}@test.com`, emailVerified: true } });
    const event = await createEvent(owner.id);
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:players"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_add_player", { eventId: event.id, userId: member.id })));
    expect(res.status).toBe(200);
    const follow = await prisma.eventFollow.findUnique({ where: { eventId_userId: { eventId: event.id, userId: member.id } } });
    expect(follow).toBeTruthy();
  });

  it("errors when no name, email or userId resolves a player", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id);
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:players"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_add_player", { eventId: event.id })));
    expect(res.status).toBe(400);
  });
});

describe("MCP write tools — remove_player", () => {
  it("removes a player (soft-archive) when actor owns the event", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id);
    const player = await addActivePlayer(event.id, event.currentGameId!, "Alice");
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:players"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_remove_player", { eventId: event.id, playerId: player.id })));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    expect(data.ok).toBe(true);
    expect(data.name).toBe("Alice");
    const archived = await prisma.player.findUnique({ where: { id: player.id } });
    expect(archived?.archivedAt).toBeTruthy();
  });

  it("removes a player by name when playerId is omitted", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id);
    await addActivePlayer(event.id, event.currentGameId!, "Carol");
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:players"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_remove_player", { eventId: event.id, name: "Carol" })));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    expect(data.name).toBe("Carol");
  });

  it("rejects remove_player for a non-owner/non-admin actor (403)", async () => {
    const owner = await createOwner();
    const outsider = await prisma.user.create({ data: { id: `mcpw-${crypto.randomUUID().slice(0, 8)}`, name: "Out2", email: `mcpw-${crypto.randomUUID().slice(0, 8)}@test.com`, emailVerified: true } });
    const event = await createEvent(owner.id);
    const player = await addActivePlayer(event.id, event.currentGameId!, "Dave");
    mockAuth.mockResolvedValue({ userId: outsider.id, scopes: ["manage:players"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_remove_player", { eventId: event.id, playerId: player.id })));
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown player", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id);
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:players"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_remove_player", { eventId: event.id, playerId: "nope" })));
    expect(res.status).toBe(404);
  });
});

describe("MCP write tools — randomize_teams", () => {
  it("creates two team results from active players", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id, { maxPlayers: 4 });
    for (const [i, name] of ["Alice", "Bob", "Carol", "Dave"].entries()) {
      await addActivePlayer(event.id, event.currentGameId!, name, i);
    }
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:teams"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_randomize_teams", { eventId: event.id })));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    expect(data.ok).toBe(true);
    const teams = await prisma.teamResult.findMany({ where: { eventId: event.id }, include: { members: true } });
    expect(teams.length).toBe(2);
    expect(teams.flatMap((t) => t.members.map((m) => m.name))).toHaveLength(4);
  });

  it("rejects when fewer than 2 players", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id);
    await addActivePlayer(event.id, event.currentGameId!, "Solo");
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:teams"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_randomize_teams", { eventId: event.id })));
    expect(res.status).toBe(400);
  });

  it("balances teams by ELO when balanced=true", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id, { maxPlayers: 4 });
    for (const [i, name] of ["Alice", "Bob", "Carol", "Dave"].entries()) {
      await addActivePlayer(event.id, event.currentGameId!, name, i);
      await prisma.playerRating.create({ data: { eventId: event.id, name, rating: 1000 + i * 100 } });
    }
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:teams"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_randomize_teams", { eventId: event.id, balanced: true })));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    expect(data.balanced).toBe(true);
    expect(data.teams).toHaveLength(2);
  });

  it("uses the legacy player list when the event has no current game", async () => {
    const owner = await createOwner();
    const event = await prisma.event.create({ data: { title: "Legacy", location: "Lisbon", dateTime: new Date(Date.now() + 86400_000), maxPlayers: 4, ownerId: owner.id } });
    for (const [i, name] of ["A", "B", "C", "D"].entries()) {
      await prisma.player.create({ data: { eventId: event.id, name, order: i } });
    }
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:teams"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_randomize_teams", { eventId: event.id })));
    expect(res.status).toBe(200);
    const teams = await prisma.teamResult.count({ where: { eventId: event.id } });
    expect(teams).toBe(2);
  });
});

describe("MCP write tools — update_payment", () => {
  async function seedCost(eventId: string) {
    const cost = await prisma.eventCost.create({ data: { eventId, totalAmount: 50 } });
    await prisma.playerPayment.create({ data: { eventCostId: cost.id, playerName: "Alice", amount: 10, status: "pending" } });
    return cost;
  }

  it("marks a player payment as paid and writes the ledger credit", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id);
    await addActivePlayer(event.id, event.currentGameId!, "Alice");
    await seedCost(event.id);
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:payments"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_update_payment", { eventId: event.id, playerName: "Alice", status: "paid", method: "mbway" })));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    expect(data.status).toBe("paid");
    const ledger = await prisma.walletTransaction.findFirst({ where: { eventId: event.id, reason: "payment_received" } });
    expect(ledger).toBeTruthy();
  });

  it("rejects an invalid payment status", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id);
    await addActivePlayer(event.id, event.currentGameId!, "Alice");
    await seedCost(event.id);
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:payments"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_update_payment", { eventId: event.id, playerName: "Alice", status: "refunded" })));
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.code).toBe(-32602);
  });

  it("returns 404 when no cost is set", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id);
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:payments"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_update_payment", { eventId: event.id, playerName: "Alice", status: "paid" })));
    expect(res.status).toBe(404);
  });

  it("marks pending/sent without writing a ledger row", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id);
    await addActivePlayer(event.id, event.currentGameId!, "Alice");
    await seedCost(event.id);
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["manage:payments"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_update_payment", { eventId: event.id, playerName: "Alice", status: "sent" })));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    expect(data.status).toBe("sent");
    const ledger = await prisma.walletTransaction.findFirst({ where: { eventId: event.id, reason: "payment_received" } });
    expect(ledger).toBeNull();
  });
});

describe("MCP write tools — set_score", () => {
  it("updates the latest game history score and processes ELO", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id);
    await prisma.playerRating.create({ data: { eventId: event.id, name: "Alice", rating: 1000 } });
    await prisma.playerRating.create({ data: { eventId: event.id, name: "Bob", rating: 1000 } });
    const history = await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: event.dateTime,
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
        status: "played",
        teamsSnapshot: JSON.stringify([
          { team: "Ninjas", players: [{ name: "Alice", order: 0 }] },
          { team: "Gunas", players: [{ name: "Bob", order: 0 }] },
        ]),
      },
    });
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["write:events"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_set_score", { eventId: event.id, scoreOne: 3, scoreTwo: 1 })));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    expect(data.scoreOne).toBe(3);
    expect(data.scoreTwo).toBe(1);
    const updated = await prisma.gameHistory.findUnique({ where: { id: history.id } });
    expect(updated?.eloProcessed).toBe(true);
  });

  it("errors when there is no history yet", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id);
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["write:events"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_set_score", { eventId: event.id, scoreOne: 2, scoreTwo: 2 })));
    expect(res.status).toBe(404);
  });

  it("validates score args", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id);
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["write:events"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_set_score", { eventId: event.id, scoreOne: -1, scoreTwo: 2 })));
    expect(res.status).toBe(400);
  });

  it("rejects when scores are missing", async () => {
    const owner = await createOwner();
    const event = await createEvent(owner.id);
    mockAuth.mockResolvedValue({ userId: owner.id, scopes: ["write:events"], authMethod: "oauth", clientId: "c1" });
    const res = await POST(ctx(callTool("convocados_set_score", { eventId: event.id })));
    const body: any = await res.json();
    expect(body.error.code).toBe(-32602);
  });
});

describe("MCP write tools — tools/list surface", () => {
  it("exposes all six write tools alongside the read tools", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { "MCP-Protocol-Version": PROTOCOL, "Mcp-Method": "tools/list" }
    );
    const res = await POST(ctx(req));
    const body: any = await res.json();
    const names = body.result.tools.map((t: any) => t.name);
    expect(names).toEqual([...names].sort());
    for (const tool of ["convocados_add_player", "convocados_remove_player", "convocados_randomize_teams", "convocados_update_payment", "convocados_set_score", "convocados_create_event"]) {
      expect(names).toContain(tool);
    }
    expect(names).toHaveLength(12);
  });
});