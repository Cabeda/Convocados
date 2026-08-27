import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: vi.fn(),
  requireScope: vi.fn((ctx: any, scope: string) => ctx.scopes.includes("*") || ctx.scopes.includes(scope)),
}));
vi.mock("~/lib/apiRateLimit.server", async (importOriginal) => {
  const orig = await importOriginal() as any;
  return { ...orig, checkApiRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })), extractIp: () => "127.0.0.1" };
});

import { authenticateRequest } from "~/lib/authenticate.server";
import { checkApiRateLimit } from "~/lib/apiRateLimit.server";
const { POST } = await import("~/pages/api/mcp");
const mockAuth = vi.mocked(authenticateRequest);
const mockRate = vi.mocked(checkApiRateLimit);
const PROTOCOL = "2026-07-28";

function req(body: any, headers: Record<string, string> = {}) {
  return new Request("http://localhost:4321/api/mcp", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
function badReq(raw: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost:4321/api/mcp", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw });
}
function ctx(r: Request) { return { request: r } as any; }

beforeEach(async () => {
  await prisma.event.deleteMany();
  await prisma.$executeRawUnsafe("DELETE FROM oauthAccessToken");
  vi.clearAllMocks();
  mockRate.mockResolvedValue({ allowed: true, remaining: 10, retryAfterMs: 0 } as any);
});

describe("MCP extra branches", () => {
  it("parse error returns -32700", async () => {
    const r = badReq("not json", { "MCP-Protocol-Version": PROTOCOL, "Mcp-Method": "tools/list" });
    const res = await POST(ctx(r));
    expect(res.status).toBe(400);
    const b: any = await res.json();
    expect(b.error.code).toBe(-32700);
  });

  it("missing eventId returns -32602 for get_game", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    const r = req({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "convocados_get_game", arguments: {} } }, { "MCP-Protocol-Version": PROTOCOL, "Mcp-Method": "tools/call", "Mcp-Name": "convocados_get_game" });
    const res = await POST(ctx(r));
    expect(res.status).toBe(400);
    const b: any = await res.json();
    expect(b.error.code).toBe(-32602);
  });

  it("missing eventId for list_players", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    const r = req({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "convocados_list_players", arguments: {} } }, { "MCP-Protocol-Version": PROTOCOL, "Mcp-Method": "tools/call", "Mcp-Name": "convocados_list_players" });
    const res = await POST(ctx(r));
    const b: any = await res.json();
    expect(b.error.code).toBe(-32602);
  });

  it("missing eventId for get_balance", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    const r = req({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "convocados_get_balance", arguments: {} } }, { "MCP-Protocol-Version": PROTOCOL, "Mcp-Method": "tools/call", "Mcp-Name": "convocados_get_balance" });
    const res = await POST(ctx(r));
    const b: any = await res.json();
    expect(b.error.code).toBe(-32602);
  });

  it("404 for get_balance when event missing", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    const r = req({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "convocados_get_balance", arguments: { eventId: "missing" } } }, { "MCP-Protocol-Version": PROTOCOL, "Mcp-Method": "tools/call", "Mcp-Name": "convocados_get_balance" });
    const res = await POST(ctx(r));
    expect(res.status).toBe(404);
    const b: any = await res.json();
    expect(b.error.code).toBe(-32001);
  });

  it("rate limited returns 429", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    mockRate.mockResolvedValue({ allowed: false, remaining: 0, retryAfterMs: 5000 } as any);
    const r = req({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, { "MCP-Protocol-Version": PROTOCOL, "Mcp-Method": "tools/list" });
    const res = await POST(ctx(r));
    expect(res.status).toBe(429);
    const b: any = await res.json();
    expect(b.error.code).toBe(-32000);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("unknown method returns -32601", async () => {
    mockAuth.mockResolvedValue({ userId: "u1", scopes: ["*"], authMethod: "oauth", clientId: "c1" });
    const r = req({ jsonrpc: "2.0", id: 1, method: "unknown/method", params: {} }, { "MCP-Protocol-Version": PROTOCOL, "Mcp-Method": "unknown/method" });
    const res = await POST(ctx(r));
    expect(res.status).toBe(400);
    const b: any = await res.json();
    expect(b.error.code).toBe(-32601);
  });
});
