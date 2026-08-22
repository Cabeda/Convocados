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
  it("rejects missing MCP-Protocol-Version header", async () => {
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { "Mcp-Method": "tools/list" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toMatch(/MCP-Protocol-Version/i);
  });

  it("rejects unsupported protocol version", async () => {
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { "MCP-Protocol-Version": "2024-11-05", "Mcp-Method": "tools/list" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.code).toBe(-32600);
  });

  it("rejects missing Mcp-Method header", async () => {
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { "MCP-Protocol-Version": PROTOCOL_VERSION }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toMatch(/Mcp-Method/i);
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

  it("rejects initialize with hint to server/discover", async () => {
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "initialize" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toMatch(/initialize.*retired/i);
    expect(body.error.data?.hint).toMatch(/server\/discover/i);
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

  it("tools/list requires auth", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/list" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.error.code).toBe(-32001);
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

  it("tools/call requires Mcp-Name header", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    const req = makeRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "convocados_list_my_games", arguments: {} } },
      { "MCP-Protocol-Version": PROTOCOL_VERSION, "Mcp-Method": "tools/call" }
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.message).toMatch(/Mcp-Name/i);
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

  it("GET returns 405 with SSE deprecation hint", async () => {
    const req = new Request("http://localhost:4321/api/mcp", { method: "GET" });
    const res = await GET({ request: req } as any);
    expect(res.status).toBe(405);
    const body: any = await res.json();
    expect(body.error.message).toMatch(/POST/i);
  });
});
