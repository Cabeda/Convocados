import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: vi.fn(),
  requireScope: vi.fn((ctx: any, scope: string) => {
    if (ctx.scopes.includes("*")) return true;
    return ctx.scopes.includes(scope);
  }),
}));

vi.mock("~/lib/logger.server", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  return { logger, createLogger: () => logger };
});

import { authenticateRequest } from "~/lib/authenticate.server";
import { TOOLS } from "~/lib/mcp/tools";
import { logger } from "~/lib/logger.server";
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

  it("advertises only the capabilities it serves", async () => {
    // A capability in `initialize` with no handler behind it (resources/list
    // answered -32601) makes strict clients treat the connector as degraded —
    // ChatGPT dropped every tool until we stopped advertising it.
    const req = makeRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" },
    } });
    const res = await POST(ctx(req));
    const body: any = await res.json();
    expect(Object.keys(body.result.capabilities)).toEqual(["tools"]);
    expect(body.result.instructions).toMatch(/timezone/i);
  });

  it("every listed tool carries a title and the directory's hints", async () => {
    // The Claude directory flags submissions whose tools lack a title or an
    // annotation, so a new tool without them must fail here, not in review.
    const req = makeRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const tools: any[] = (await (await POST(ctx(req))).json()).result.tools;

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.title, `${tool.name} title`).toBeTruthy();
      expect(tool.description, `${tool.name} description`).toBeTruthy();
      // OpenAI's listing scanner requires all three hints as explicit booleans.
      expect(tool.annotations, `${tool.name} annotations`).toBeDefined();
      expect(typeof tool.annotations.readOnlyHint, `${tool.name} readOnlyHint`).toBe("boolean");
      expect(typeof tool.annotations.destructiveHint, `${tool.name} destructiveHint`).toBe("boolean");
      expect(typeof tool.annotations.openWorldHint, `${tool.name} openWorldHint`).toBe("boolean");
      if (tool.annotations.readOnlyHint === true) {
        expect(tool.annotations.destructiveHint, `${tool.name} read tool must not be destructive`).toBe(false);
      } else {
        expect(tool.annotations.readOnlyHint, `${tool.name} readOnlyHint`).toBe(false);
      }
    }
    // Additive stays non-destructive; removing or overwriting is not.
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect((byName.get("convocados_list_my_games") as any).annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect((byName.get("convocados_cancel_event") as any).annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
    expect((byName.get("convocados_create_event") as any).annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
    // The model needs the format spelled out, or it passes a UTC time for a
    // local kickoff and the game lands an hour or two off.
    const create = byName.get("convocados_create_event") as any;
    expect(create.description).toMatch(/ISO 8601/);
    expect(create.description).toMatch(/timezone/i);
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
    // The modern DiscoverResult shape, field for field: a client that cannot
    // find `supportedVersions` reports "action discovery failed" and never asks
    // for the tool list (ChatGPT, 2026-11-02).
    expect(body.result.resultType).toBe("complete");
    expect(body.result.supportedVersions).toEqual(expect.arrayContaining([PROTOCOL_VERSION]));
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result._meta?.["io.modelcontextprotocol/serverInfo"].name).toBe("convocados");
    expect(typeof body.result.ttlMs).toBe("number");
    expect(body.result.cacheScope).toBe("public");
  });

  it("tools/list is anonymous (mixed authentication)", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body.result.tools)).toBe(true);
    // The JSON-RPC method is logged because the HTTP trace cannot tell a
    // connector ping from a tool call.
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ mcp: "tools/list", auth: "none" }),
      "mcp message",
    );
  });

  it("logs the method for an anonymous initialize", async () => {
    mockAuth.mockResolvedValue(null);
    vi.mocked(logger.info).mockClear();
    const req = makeRequest({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "c", version: "1" } },
    });
    const res = await POST(ctx(req));
    expect(res.status).toBe(200);
    // initialize vs ping is the whole question for a connector that never calls
    // a tool, so the discriminator must be pinned.
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ mcp: "initialize", clientProtocol: "2025-11-25" }),
      "mcp message",
    );
  });

  it("logs a message it rejects on the protocol header too", async () => {
    vi.mocked(logger.info).mockClear();
    const req = makeRequest(
      { jsonrpc: "2.0", id: 7, method: "tools/list", params: {} },
      { "MCP-Protocol-Version": "1999-01-01" },
    );
    const res = await POST(ctx(req));
    expect(res.status).toBe(400);
    // A rejected message must not look like silence in the log.
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ mcp: "tools/list" }),
      "mcp message",
    );
  });

  it("truncates client-supplied fields so a payload cannot inflate the log", async () => {
    vi.mocked(logger.info).mockClear();
    const req = makeRequest({
      jsonrpc: "2.0", id: 1, method: "x".repeat(500), params: { name: "y".repeat(500) },
    });
    await POST(ctx(req));
    const logged = vi.mocked(logger.info).mock.calls.find(([, msg]) => msg === "mcp message")?.[0] as
      | { mcp?: string; tool?: string }
      | undefined;
    expect(logged?.mcp).toHaveLength(64);
    expect(logged?.tool).toHaveLength(64);
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
    // Cache hints live at the top level of a modern result (MCP 2026-07-28),
    // and `cacheScope` is `public` or `private` — not an invented "global".
    expect(body.result.resultType).toBe("complete");
    expect(body.result.ttlMs).toBe(60000);
    expect(body.result.cacheScope).toBe("public");
    // convocados prefix
    expect(names.every((n: string) => n.startsWith("convocados_"))).toBe(true);
    // ChatGPT reads per-tool securitySchemes to know which tools need the
    // OAuth link; an anonymous tool must also advertise noauth so it stays
    // callable before the user connects. Asserted as an exact mapping, not
    // `some()`: the value that matters is which tools are in each set.
    for (const tool of body.result.tools) {
      const def = TOOLS.find((t) => t.name === tool.name);
      expect(def).toBeDefined();
      expect(tool.securitySchemes.map((s: any) => s.type).sort()).toEqual(
        def?.requiresAuth === false ? ["noauth", "oauth2"] : ["oauth2"],
      );
      const oauth = tool.securitySchemes.find((s: any) => s.type === "oauth2");
      expect(oauth?.scopes).toEqual([def?.scope]);
    }
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
    // The advertised scope is the connector's whole capability set: one tool's
    // scope would mint a token that can read but not write.
    expect(challenge).toMatch(/scope="[^"]*\bread:events\b/);
    expect(challenge).toMatch(/\bcreate:events\b/);
    // ChatGPT needs the challenge in the body too, with both error params.
    const body: any = await res.json();
    const fromBody = body._meta?.["mcp/www_authenticate"]?.[0] ?? "";
    expect(fromBody).toContain('error="invalid_token"');
    expect(fromBody).toContain("error_description=");
    expect(fromBody).toMatch(/resource_metadata=/);
    // Also inside the error object: the MCP schema allows `_meta` there, and
    // that is where a spec-following reader looks for it.
    expect(body.error?._meta?.["mcp/www_authenticate"]?.[0]).toBe(fromBody);
  });

  it("tools/call without the needed scope returns 403 with a step-up challenge", async () => {
    mockAuth.mockResolvedValue({ userId: "mcp-user-2", scopes: ["read:events"], authMethod: "oauth", clientId: "c2" });
    const req = makeRequest({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "convocados_create_event", arguments: { title: "Game", location: "Pitch", dateTime: new Date().toISOString(), maxPlayers: 10 } },
    });
    const res = await POST(ctx(req));
    expect(res.status).toBe(403);
    const challenge = res.headers.get("WWW-Authenticate") ?? "";
    // Without `error="insufficient_scope"` Claude treats the 403 as terminal —
    // no re-authorization prompt, and the connector looks broken.
    expect(challenge).toContain('error="insufficient_scope"');
    // Every scope still needed, not just the missing one.
    expect(challenge).toMatch(/scope="[^"]*\bread:events\b/);
    expect(challenge).toMatch(/\bcreate:events\b/);
    // Same challenge in the body, so ChatGPT can offer the step-up link.
    const body: any = await res.json();
    expect(body._meta?.["mcp/www_authenticate"]?.[0]).toContain('error="insufficient_scope"');
    expect(body._meta?.["mcp/www_authenticate"]?.[0]).toContain("error_description=");
    // And inside the error object, where the MCP schema allows `_meta`.
    expect(body.error?._meta?.["mcp/www_authenticate"]?.[0]).toContain("error_description=");
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
