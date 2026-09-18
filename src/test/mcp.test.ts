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
// Import after mock
const { POST, GET } = await import("~/pages/api/mcp");

const mockAuth = vi.mocked(authenticateRequest);

beforeEach(async () => {
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$executeRawUnsafe("DELETE FROM oauthAccessToken");
  vi.clearAllMocks();
});

function makeRequest(body: any, headers: Record<string, string> = {}) {
  return new Request("http://localhost:4321/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function ctx(req: Request) {
  return { request: req } as any;
}

const PROTOCOL_VERSION = "2026-07-28";

describe("POST /api/mcp — stateless transport", () => {
  it("accepts requests without protocol headers (handshake era)", async () => {
    const req = makeRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body.result.tools)).toBe(true);
  });

  it("rejects an unknown protocol version header", async () => {
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { "MCP-Protocol-Version": "1999-01-01", "Mcp-Method": "tools/list" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.code).toBe(-32600);
  });

  it("treats Mcp-Method as optional", async () => {
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { "MCP-Protocol-Version": PROTOCOL_VERSION }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
  });

  it("rejects Mcp-Method mismatch with body method", async () => {
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "convocados_list_my_games" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toMatch(/mismatch/i);
  });

  it("negotiates the handshake version on initialize", async () => {
    const req = makeRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ChatGPT", version: "1" } },
    });
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.serverInfo.name).toBe("convocados");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it("counter-offers the latest handshake version when asked for the modern one", async () => {
    const req = makeRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2026-07-28" } });
    const res = await POST(ctx(req));
    const body: any = await res.json();
    expect(body.result.protocolVersion).toBe("2025-11-25");
  });

  it("accepts notifications/initialized with 202 and no body", async () => {
    const req = makeRequest({ jsonrpc: "2.0", method: "notifications/initialized" });
    const res = await POST(ctx(req));
    expect(res.status).toBe(202);
  });

  it("answers ping", async () => {
    const req = makeRequest({ jsonrpc: "2.0", id: 7, method: "ping" });
    const res = await POST(ctx(req));
    const body: any = await res.json();
    expect(body.result).toEqual({});
  });

  it("handles server/discover without auth", async () => {
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "server/discover", params: {} },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "server/discover" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.serverInfo.name).toBe("convocados");
  });

  it("tools/list is anonymous (mixed authentication)", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body.result.tools)).toBe(true);
  });

  it("tools/list returns deterministic list with cache hints when authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/list" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.result.tools).toBeDefined();
    expect(Array.isArray(body.result.tools)).toBe(true);
    expect(body.result.tools.length).toBeGreaterThanOrEqual(6);
    // deterministic order
    const names = body.result.tools.map((t: any) => t.name);
    expect(names).toEqual([...names].sort());
    // cache hints per SEP-2549
    expect(body.result._meta?.ttlMs).toBe(60000);
    expect(body.result._meta?.cacheScope).toBe("global");
    // convocados prefix
    expect(names.every((n: string) => n.startsWith("convocados_"))).toBe(true);
  });

  it("tools/call needs only params.name (Mcp-Name optional)", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "convocados_list_my_games", arguments: {} } },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/call" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
  });

  it("tools/call rejects Mcp-Name mismatch", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "convocados_list_my_games", arguments: {} } },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "convocados_get_game" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toMatch(/mismatch/i);
  });

  it("tools/call returns 404 for unknown tool", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "unknown_tool", arguments: {} } },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "unknown_tool" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.error.code).toBe(-32601);
  });

  it("tools/call convocados_list_my_games succeeds with auth", async () => {
    const user = await prisma.user.create({ data: { id: "mcp-user-1", name: "MCP User", email: "mcp1@test.com", emailVerified: true } });
    await prisma.event.create({ data: { title: "Owned Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10, ownerId: user.id } });
    mockAuth.mockResolvedValue({ userId: user.id, scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    const req = makeRequest(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "convocados_list_my_games", arguments: {} } },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "convocados_list_my_games" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.result.content).toBeDefined();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.owned).toBeDefined();
    expect(parsed.owned.length).toBe(1);
  });

  it("tools/call on an auth-required tool returns 401 with WWW-Authenticate", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "convocados_list_my_games", arguments: {} },
    });
    const res = await POST(ctx(req));
    expect(res.status).toBe(401);
    const challenge = res.headers.get("WWW-Authenticate") ?? "";
    expect(challenge).toMatch(/Bearer/);
    expect(challenge).toMatch(/resource_metadata=/);
    expect(challenge).toMatch(/scope="read:events"/);
  });

  it("anonymous tools/call can fetch a link-accessible event", async () => {
    const event = await prisma.event.create({
      data: { title: "Public Link Game", location: "Pitch", dateTime: new Date(Date.now() + 86_400_000), maxPlayers: 10, isPublic: false },
    });
    mockAuth.mockResolvedValue(null);
    const req = makeRequest({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "convocados_get_game", arguments: { eventId: event.id } },
    });
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.title).toBe("Public Link Game");
    expect(parsed.spotsLeft).toBe(10);
  });

  it("anonymous access to a password-locked event returns locked only", async () => {
    const event = await prisma.event.create({
      data: { title: "Locked Game", location: "Pitch", dateTime: new Date(Date.now() + 86_400_000), maxPlayers: 10, accessPassword: "scrypt$aa$bb" },
    });
    mockAuth.mockResolvedValue(null);
    const req = makeRequest({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "convocados_get_game", arguments: { eventId: event.id } },
    });
    const res = await POST(ctx(req));
    const body: any = await res.json();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.locked).toBe(true);
    expect(parsed.location).toBeUndefined();
  });

  it("anonymous tools/call can list public events", async () => {
    await prisma.event.create({
      data: { title: "Listed Game", location: "Pitch", dateTime: new Date(Date.now() + 86_400_000), maxPlayers: 10, isPublic: true },
    });
    await prisma.event.create({
      data: { title: "Hidden Game", location: "Pitch", dateTime: new Date(Date.now() + 86_400_000), maxPlayers: 10, isPublic: false },
    });
    mockAuth.mockResolvedValue(null);
    const req = makeRequest({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "convocados_list_public_events", arguments: {} },
    });
    const res = await POST(ctx(req));
    const body: any = await res.json();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.events.map((e: any) => e.title)).toEqual(["Listed Game"]);
  });

  it("GET returns 405 with SSE deprecation hint", async () => {
    const req = new Request("http://localhost:4321/api/mcp", { method: "GET" });
    const res = await GET({ request: req } as any);
    expect(res.status).toBe(405);
    const body: any = await res.json();
    expect(body.error.message).toMatch(/POST/i);
  });
});
