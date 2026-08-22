import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: vi.fn(),
  requireScope: vi.fn((ctx: any, scope: string) => {
    if (ctx.scopes.includes("*")) return true;
    return ctx.scopes.includes(scope);
  }),
}));

import { authenticateRequest } from "~/lib/authenticate.server";
const { POST } = await import("~/pages/api/mcp");
const mockAuth = vi.mocked(authenticateRequest);
const PROTOCOL_VERSION = "2026-07-28";

function makeRequest(body: any, headers: Record<string, string> = {}) {
  return new Request("http://localhost:4321/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
function ctx(req: Request) { return { request: req } as any; }

beforeEach(async () => {
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.event.deleteMany();
  await prisma.$executeRawUnsafe("DELETE FROM oauthAccessToken");
  vi.clearAllMocks();
});

describe("MCP tools — scope and handlers", () => {
  it("rejects tools/call when scope missing (403)", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["read:events"], authMethod: "oauth", clientId: "c1" });
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "convocados_get_history", arguments: { eventId: "evt1" } } },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "convocados_get_history" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.error.message).toMatch(/scope/i);
  });

  it("convocados_get_game returns event when authenticated with read:events", async () => {
    const user = await prisma.user.create({ data: { id: "mcp2-u1", name: "U", email: "mcp2u1@test.com", emailVerified: true } });
    const event = await prisma.event.create({ data: { title: "My Event", location: "Lisbon", dateTime: new Date(), maxPlayers: 12, ownerId: user.id } });
    mockAuth.mockResolvedValue({ userId: user.id, scopes: ["read:events"], authMethod: "oauth", clientId: "c1" });
    const req = makeRequest(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "convocados_get_game", arguments: { eventId: event.id } } },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "convocados_get_game" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    expect(data.id).toBe(event.id);
    expect(data.title).toBe("My Event");
  });

  it("convocados_get_game returns 404 when event not found (as JSON-RPC error)", async () => {
    const user = await prisma.user.create({ data: { id: "mcp2-u2", name: "U2", email: "mcp2u2@test.com", emailVerified: true } });
    mockAuth.mockResolvedValue({ userId: user.id, scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    const req = makeRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "convocados_get_game", arguments: { eventId: "nonexistent" } } },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "convocados_get_game" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.error.code).toBe(-32001);
  });

  it("convocados_list_players returns players for event", async () => {
    const user = await prisma.user.create({ data: { id: "mcp2-u3", name: "U3", email: "mcp2u3@test.com", emailVerified: true } });
    const event = await prisma.event.create({ data: { title: "Players Event", location: "Porto", dateTime: new Date(), maxPlayers: 10, ownerId: user.id } });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice" } });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Bob" } });
    mockAuth.mockResolvedValue({ userId: user.id, scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    const req = makeRequest(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "convocados_list_players", arguments: { eventId: event.id } } },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "convocados_list_players" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    expect(data.players.length).toBe(2);
    expect(data.players.map((p: any) => p.name).sort()).toEqual(["Alice", "Bob"]);
  });

  it("convocados_get_history returns history entries", async () => {
    const user = await prisma.user.create({ data: { id: "mcp2-u4", name: "U4", email: "mcp2u4@test.com", emailVerified: true } });
    const event = await prisma.event.create({ data: { title: "History Event", location: "Lisbon", dateTime: new Date(), maxPlayers: 10, ownerId: user.id } });
    await prisma.gameHistory.create({ data: { eventId: event.id, dateTime: new Date(), teamOneName: "A", teamTwoName: "B", scoreOne: 2, scoreTwo: 1 } });
    mockAuth.mockResolvedValue({ userId: user.id, scopes: ["read:history"], authMethod: "oauth", clientId: "c1" });
    const req = makeRequest(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "convocados_get_history", arguments: { eventId: event.id } } },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "convocados_get_history" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    expect(data.history.length).toBe(1);
    expect(data.history[0].scoreOne).toBe(2);
  });

  it("convocados_get_ratings returns ratings", async () => {
    const user = await prisma.user.create({ data: { id: "mcp2-u5", name: "U5", email: "mcp2u5@test.com", emailVerified: true } });
    const event = await prisma.event.create({ data: { title: "Ratings Event", location: "Lisbon", dateTime: new Date(), maxPlayers: 10, ownerId: user.id } });
    await prisma.playerRating.create({ data: { eventId: event.id, name: "Alice", rating: 1500 } });
    mockAuth.mockResolvedValue({ userId: user.id, scopes: ["read:ratings"], authMethod: "oauth", clientId: "c1" });
    const req = makeRequest(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "convocados_get_ratings", arguments: { eventId: event.id } } },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "convocados_get_ratings" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    expect(data.ratings.length).toBe(1);
    expect(data.ratings[0].name).toBe("Alice");
  });

  it("convocados_get_balance requires read:events scope", async () => {
    const user = await prisma.user.create({ data: { id: "mcp2-u6", name: "U6", email: "mcp2u6@test.com", emailVerified: true } });
    const event = await prisma.event.create({ data: { title: "Balance Event", location: "Lisbon", dateTime: new Date(), maxPlayers: 10, ownerId: user.id } });
    mockAuth.mockResolvedValue({ userId: user.id, scopes: ["read:events"], authMethod: "oauth", clientId: "c1" });
    const req = makeRequest(
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "convocados_get_balance", arguments: { eventId: event.id } } },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "convocados_get_balance" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    expect(data.eventId).toBe(event.id);
  });

  it("handles _meta clientInfo passthrough without failing", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    const req = makeRequest(
      { jsonrpc: "2.0", id: 8, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/clientInfo": { name: "my-app", version: "1.0" } } } },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/list" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
  });
});
