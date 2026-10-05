import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { auth } from "~/lib/auth.server";
import { MCP_TOOLS, MCP_TOOLS_BY_NAME, type McpTool } from "~/lib/mcp/tools";
import {
  handleRpc,
  listTools,
  validateArgs,
  MCP_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  RPC,
} from "~/lib/mcp/server";
import { POST as mcpPost, GET as mcpGet, DELETE as mcpDelete } from "~/pages/api/mcp";
import { GET as prMetadata } from "~/pages/.well-known/oauth-protected-resource/api/mcp";
import type { AuthContext } from "~/lib/authenticate.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const TOKEN = "mcp-test-token";

/** Minimal args that satisfy every tool's `required` list; extras are ignored. */
const ARGS = { eventId: "e1", field: "title", value: "x" } as Record<string, unknown>;

const BEARER = { authorization: `Bearer ${TOKEN}` };

function authCtx(scopes: string[] = ["*"]): AuthContext {
  return { userId: "u1", scopes, authMethod: "oauth", clientId: "c1" };
}

const rpc = (method: string, params?: unknown, id: unknown = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params !== undefined ? { params } : {}),
});

/** Records calls and returns a canned JSON response. */
function fakeFetch(payload: unknown = { ok: true }, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

beforeEach(async () => {
  await prisma.oauthAccessToken.deleteMany();
  await prisma.oauthClient.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetApiRateLimitStore();
  vi.restoreAllMocks();
  vi.spyOn(auth.api, "getSession").mockResolvedValue(null as never);
});

// ───────────────────────────── tool table shape ─────────────────────────────

describe("MCP tool table", () => {
  it("has unique snake_case names", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("stays within the tool count models can reliably choose between", () => {
    // ponytail: >30 measurably degrades tool selection; raise this only with a
    // reason and a re-measured selection rate.
    expect(MCP_TOOLS.length).toBeLessThanOrEqual(30);
    expect(MCP_TOOLS.length).toBeGreaterThan(10);
  });

  it("gives every tool a substantive description", () => {
    for (const tool of MCP_TOOLS) {
      // Length floor + terminal period: catches placeholder and truncated text
      // without pinning prose that would make the table fussy to maintain.
      expect(tool.description.length, `${tool.name} description`).toBeGreaterThan(40);
      expect(tool.description.trimEnd(), `${tool.name} ends with a period`).toMatch(/\.$/);
    }
  });

  it("declares an object inputSchema whose required keys all exist as properties", () => {
    for (const tool of MCP_TOOLS) {
      const schema = tool.inputSchema as {
        type: string;
        properties: Record<string, unknown>;
        required?: string[];
      };
      expect(schema.type, `${tool.name} inputSchema.type`).toBe("object");
      expect(schema.properties, `${tool.name} properties`).toBeTypeOf("object");
      for (const key of schema.required ?? []) {
        expect(schema.properties, `${tool.name} required "${key}"`).toHaveProperty(key);
      }
    }
  });

  it("documents every non-required property it accepts", () => {
    for (const tool of MCP_TOOLS) {
      const schema = tool.inputSchema as { properties: Record<string, { description?: string }> };
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (key === "eventId") continue; // shared, documented by EVENT_ID
        expect(prop?.description, `${tool.name}.${key}`).toBeTruthy();
      }
    }
  });

  it("marks mutations as non-read-only and deletions as destructive", () => {
    for (const tool of MCP_TOOLS) {
      const reads = /^(whoami|list_events|get_event|get_event_history|get_my_stats|get_payments)$/;
      if (reads.test(tool.name)) {
        expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      } else {
        expect(tool.annotations?.readOnlyHint ?? false, tool.name).toBe(false);
      }
      if (/^(remove_player|leave_event|unfollow_event|cancel_event)$/.test(tool.name)) {
        expect(tool.annotations?.destructiveHint, tool.name).toBe(true);
      }
    }
  });

  it("only declares scopes that exist in the OAuth scope list", () => {
    const known = new Set([
      "read:profile", "read:events", "write:events", "create:events", "manage:players",
      "read:ratings", "read:history", "manage:teams", "manage:webhooks", "manage:push",
      "read:calendar", "manage:payments",
    ]);
    for (const tool of MCP_TOOLS) {
      if (tool.scope) expect(known.has(tool.scope), `${tool.name} scope ${tool.scope}`).toBe(true);
    }
  });

  it("scopes every organiser action and leaves player self-service unscoped", () => {
    const organiserOnly = [
      "create_event", "update_event", "cancel_event", "add_player", "remove_player",
      "set_no_show", "randomize_teams", "set_teams", "set_cost", "mark_payment",
      "post_result", "get_payments",
    ];
    for (const name of organiserOnly) {
      expect(MCP_TOOLS_BY_NAME.get(name)?.scope, name).toBeTruthy();
    }
    for (const name of ["rsvp", "claim_player", "leave_event", "follow_event", "unfollow_event"]) {
      expect(MCP_TOOLS_BY_NAME.get(name)?.scope, name).toBeUndefined();
    }
  });

  it("routes every tool at an /api path on this origin", async () => {
    for (const tool of MCP_TOOLS) {
      const call = await tool.call(ARGS, { userId: "u1" });
      expect(call.path, tool.name).toMatch(/^\/api\//);
      expect(call.method, tool.name).toMatch(/^(GET|POST|PUT|PATCH|DELETE)$/);
    }
  });
});

// ───────────────────────────── arg validation ───────────────────────────────

describe("validateArgs", () => {
  const tool = (over: Partial<McpTool> = {}): McpTool => ({
    name: "t",
    description: "d",
    inputSchema: { type: "object", properties: { a: { type: "string" }, b: { enum: ["x", "y"] } }, required: ["a"] },
    annotations: {},
    call: () => ({ path: "/", method: "GET" }),
    ...over,
  });

  it("rejects a non-object arguments value", () => {
    expect(validateArgs(tool(), "nope")).toEqual({
      ok: false,
      message: 'Tool "t" expects a JSON object of arguments.',
    });
    expect(validateArgs(tool(), ["a"]).ok).toBe(false);
    expect(validateArgs(tool(), null).ok).toBe(false);
  });

  it("rejects missing and null required arguments, naming the key", () => {
    expect(validateArgs(tool(), {})).toEqual({
      ok: false,
      message: 'Tool "t" is missing required argument "a".',
    });
    expect(validateArgs(tool(), { a: null }).ok).toBe(false);
  });

  it("rejects a value outside an enum and lists the allowed set", () => {
    const res = validateArgs(tool(), { a: "ok", b: "z" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toBe('Argument "b" must be one of: x, y (got "z").');
  });

  it("accepts valid args and ignores unknown extra keys", () => {
    const res = validateArgs(tool(), { a: "ok", b: "x", junk: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.args.junk).toBe(true);
  });

  it("treats an absent arguments field as an empty object", () => {
    const res = validateArgs(MCP_TOOLS_BY_NAME.get("whoami")!, undefined);
    expect(res.ok).toBe(true);
  });
});

// ───────────────────────────── protocol ─────────────────────────────────────

describe("handleRpc — protocol", () => {
  it("negotiates the requested protocol version when supported", async () => {
    const res = await handleRpc(rpc("initialize", { protocolVersion: "2025-03-26" }), {
      auth: authCtx(), origin: "http://x", authHeaders: BEARER,
    });
    const body = res.body as any;
    expect(body.result.protocolVersion).toBe("2025-03-26");
    expect(body.result.serverInfo.name).toBe("convocados");
    expect(body.result.capabilities.tools).toEqual({ listChanged: false });
  });

  it("falls back to the latest version for an unknown or missing one", async () => {
    for (const params of [{ protocolVersion: "1999-01-01" }, {}, undefined]) {
      const res = await handleRpc(rpc("initialize", params), {
        auth: authCtx(), origin: "http://x", authHeaders: BEARER,
      });
      expect((res.body as any).result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    }
  });

  it("supports every advertised version", async () => {
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
      const res = await handleRpc(rpc("initialize", { protocolVersion: version }), {
        auth: authCtx(), origin: "http://x", authHeaders: BEARER,
      });
      expect((res.body as any).result.protocolVersion).toBe(version);
    }
  });

  it("includes usage instructions so the model does not need the tool list explained", async () => {
    const res = await handleRpc(rpc("initialize"), { auth: authCtx(), origin: "http://x", authHeaders: BEARER });
    expect((res.body as any).result.instructions).toContain("list_events");
  });

  it("answers ping with an empty result", async () => {
    const res = await handleRpc(rpc("ping"), { auth: authCtx(), origin: "http://x", authHeaders: BEARER });
    expect(res.status).toBe(200);
    expect((res.body as any).result).toEqual({});
  });

  it("returns method-not-found for an unknown method", async () => {
    const res = await handleRpc(rpc("resources/list"), { auth: authCtx(), origin: "http://x", authHeaders: BEARER });
    expect((res.body as any).error.code).toBe(RPC.METHOD_NOT_FOUND);
  });

  it("rejects a malformed envelope", async () => {
    for (const bad of [{ jsonrpc: "1.0", id: 1, method: "ping" }, { id: 1, method: 42 }, "str", [1, 2], null]) {
      const res = await handleRpc(bad, { auth: authCtx(), origin: "http://x", authHeaders: BEARER });
      expect((res.body as any).error.code).toBe(RPC.INVALID_REQUEST);
    }
  });

  it("returns no body for notifications and echoes the id for requests", async () => {
    const notification = await handleRpc(rpc("notifications/initialized", undefined, undefined), {
      auth: authCtx(), origin: "http://x", authHeaders: BEARER,
    });
    expect(notification.body).toBeNull();
    expect(notification.status).toBe(202);

    const request = await handleRpc(rpc("ping", undefined, "abc"), {
      auth: authCtx(), origin: "http://x", authHeaders: BEARER,
    });
    expect((request.body as any).id).toBe("abc");
  });

  it("lists every tool with the wire fields the spec requires", async () => {
    const res = await handleRpc(rpc("tools/list"), { auth: authCtx(), origin: "http://x", authHeaders: BEARER });
    const { tools } = (res.body as any).result;
    expect(tools).toHaveLength(MCP_TOOLS.length);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.annotations).toBeTypeOf("object");
    }
    expect(listTools()).toHaveLength(MCP_TOOLS.length);
  });

  it("does not leak the internal call signature to clients", async () => {
    for (const tool of listTools()) {
      expect(Object.keys(tool).sort()).toEqual(["annotations", "description", "inputSchema", "name"]);
    }
  });
});

// ───────────────────────────── tools/call ───────────────────────────────────

describe("handleRpc — tools/call", () => {
  const deps = (scopes = ["*"], fetchImpl?: typeof fetch) => ({
    auth: authCtx(scopes), origin: "http://localhost:4321", authHeaders: BEARER, fetchImpl,
  });

  it("rejects an unknown tool and lists what is available", async () => {
    const res = await handleRpc(rpc("tools/call", { name: "drop_database", arguments: {} }), deps());
    const error = (res.body as any).error;
    expect(error.code).toBe(RPC.INVALID_PARAMS);
    expect(error.message).toContain("drop_database");
    expect(error.message).toContain("list_events");
  });

  it("requires a tool name", async () => {
    const res = await handleRpc(rpc("tools/call", { arguments: {} }), deps());
    expect((res.body as any).error.code).toBe(RPC.INVALID_PARAMS);
  });

  it("enforces the declared OAuth scope", async () => {
    const res = await handleRpc(rpc("tools/call", { name: "randomize_teams", arguments: { eventId: "e1" } }), deps(["read:events"]));
    const error = (res.body as any).error;
    expect(error.code).toBe(RPC.FORBIDDEN);
    expect(error.message).toContain("manage:teams");
  });

  it("lets a wildcard/session auth context through any scope", async () => {
    const { impl } = fakeFetch({ ok: true });
    const res = await handleRpc(
      rpc("tools/call", { name: "randomize_teams", arguments: { eventId: "e1" } }),
      deps(["*"], impl),
    );
    expect((res.body as any).result.isError).toBe(false);
  });

  it("lets an unscoped self-service tool run with read-only scopes", async () => {
    const { impl, calls } = fakeFetch({ ok: true });
    const res = await handleRpc(rpc("tools/call", { name: "rsvp", arguments: { eventId: "e1", status: "yes" } }), deps(["read:events"], impl));
    expect((res.body as any).result.isError).toBe(false);
    expect(calls[0].url).toBe("http://localhost:4321/api/events/e1/rsvp");
  });

  it("rejects a missing required argument before touching the API", async () => {
    const { impl, calls } = fakeFetch();
    const res = await handleRpc(rpc("tools/call", { name: "get_event", arguments: {} }), deps(["*"], impl));
    expect((res.body as any).error.message).toContain("eventId");
    expect(calls).toHaveLength(0);
  });

  it("forwards the caller token and method to the internal route", async () => {
    const { impl, calls } = fakeFetch({ ok: true });
    await handleRpc(
      rpc("tools/call", { name: "follow_event", arguments: { eventId: "e1" } }),
      deps(["*"], impl),
    );
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].url).toBe("http://localhost:4321/api/events/e1/follow");
  });

  it("returns the route payload as readable text content", async () => {
    const { impl } = fakeFetch({ id: "e1", players: [{ name: "Ada" }] });
    const res = await handleRpc(rpc("tools/call", { name: "get_event", arguments: { eventId: "e1" } }), deps(["*"], impl));
    const result = (res.body as any).result;
    expect(result.isError).toBe(false);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text).players[0].name).toBe("Ada");
  });

  it("surfaces an upstream 4xx as a tool error the model can read, not a protocol error", async () => {
    const { impl } = fakeFetch({ error: "Only the event owner can do this." }, 403);
    const res = await handleRpc(rpc("tools/call", { name: "set_teams", arguments: { eventId: "e1", teamOnePlayerIds: [], teamTwoPlayerIds: [] } }), deps(["*"], impl));
    const result = (res.body as any).result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 403");
    expect(result.content[0].text).toContain("Only the event owner");
    expect((res.body as any).error).toBeUndefined();
  });

  it("turns an unreachable API into a tool error instead of throwing", async () => {
    const boom = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const res = await handleRpc(rpc("tools/call", { name: "get_event", arguments: { eventId: "e1" } }), deps(["*"], boom));
    expect((res.body as any).result.isError).toBe(true);
    expect((res.body as any).result.content[0].text).toContain("ECONNREFUSED");
  });

  it("rejects an out-of-enum field before touching the API", async () => {
    const { impl, calls } = fakeFetch();
    const res = await handleRpc(
      rpc("tools/call", { name: "update_event", arguments: { eventId: "e1", field: "nope", value: 1 } }),
      deps(["*"], impl),
    );
    const error = (res.body as any).error;
    expect(error.code).toBe(RPC.INVALID_PARAMS);
    expect(error.message).toContain("title, location, dateTime, duration, sport, visibility");
    expect(calls).toHaveLength(0);
  });

  it("keeps a defensive guard for a bad field that skips validation", async () => {
    const { impl } = fakeFetch();
    const res = await handleRpc(
      rpc("tools/call", { name: "get_event", arguments: { eventId: "e1" } }),
      deps(["*"], impl),
    );
    expect((res.body as any).result.isError).toBe(false);

    // Bypass validateArgs the way a future caller could, and confirm the tool
    // itself refuses rather than building a bogus path.
    const tool = MCP_TOOLS_BY_NAME.get("update_event")!;
    expect(() => tool.call({ eventId: "e1", field: "nope", value: 1 }, { userId: "u" })).toThrow(
      /Unknown field/,
    );
  });

  it("truncates an oversized payload instead of flooding the model", async () => {
    const { impl } = fakeFetch({ blob: "x".repeat(80_000) });
    const res = await handleRpc(rpc("tools/call", { name: "get_event", arguments: { eventId: "e1" } }), deps(["*"], impl));
    const text = (res.body as any).result.content[0].text;
    expect(text.length).toBeLessThan(51_000);
    expect(text).toContain("truncated");
  });

  it("sends no body on GET and a JSON body on mutations", async () => {
    const { impl, calls } = fakeFetch();
    await handleRpc(rpc("tools/call", { name: "get_event", arguments: { eventId: "e1" } }), deps(["*"], impl));
    await handleRpc(rpc("tools/call", { name: "remove_player", arguments: { eventId: "e1", playerId: "p1" } }), deps(["*"], impl));
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[1].init.method).toBe("DELETE");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ playerId: "p1" });
  });
});

// ───────────────────────────── tool → route mapping ─────────────────────────

describe("tool call mapping", () => {
  const callOf = async (name: string, args: Record<string, unknown>) => {
    const tool = MCP_TOOLS_BY_NAME.get(name)!;
    return tool.call(args, { userId: "u1" });
  };

  it("maps every editable event field to its own route and body key", async () => {
    const cases: Array<[string, unknown, string, Record<string, unknown>]> = [
      ["title", "Friday 5v5", "title", { title: "Friday 5v5" }],
      ["location", "Parque del Retiro", "location", { location: "Parque del Retiro" }],
      ["dateTime", "2026-10-07T19:00:00Z", "dateTime", { dateTime: "2026-10-07T19:00:00Z" }],
      ["duration", 90, "duration", { durationMinutes: 90 }],
      ["sport", "basketball-3v3", "sport", { sport: "basketball-3v3" }],
      ["visibility", false, "visibility", { isPublic: false }],
    ];
    for (const [field, value, route, body] of cases) {
      const call = await callOf("update_event", { eventId: "e1", field, value });
      expect(call.method, field).toBe("PUT");
      expect(call.path, field).toBe(`/api/events/e1/${route}`);
      expect(call.body, field).toEqual(body);
    }
  });

  it("passes timezone through only for the dateTime field", async () => {
    const withTz = await callOf("update_event", { eventId: "e1", field: "dateTime", value: "2026-10-07T19:00:00Z", timezone: "Europe/Madrid" });
    expect(withTz.body).toEqual({ dateTime: "2026-10-07T19:00:00Z", timezone: "Europe/Madrid" });
    const onTitle = await callOf("update_event", { eventId: "e1", field: "title", value: "x", timezone: "Europe/Madrid" });
    expect(onTitle.body).toEqual({ title: "x" });
  });

  it("url-encodes the event id so a hostile id cannot escape the path", async () => {
    const call = await callOf("get_event", { eventId: "../../admin" });
    expect(call.path).toBe("/api/events/..%2F..%2Fadmin");
  });

  it("passes balanced as a query flag, defaulting to false", async () => {
    expect((await callOf("randomize_teams", { eventId: "e1" })).path).toContain("balanced=false");
    expect((await callOf("randomize_teams", { eventId: "e1", balanced: true })).path).toContain("balanced=true");
  });

  it("builds list_events and history query strings from defined values only", async () => {
    expect((await callOf("list_events", { limit: 5 })).path).toBe("/api/me/games?limit=5");
    expect((await callOf("list_events", {})).path).toBe("/api/me/games");
    expect((await callOf("get_event_history", { eventId: "e1", limit: 3 })).path).toBe("/api/events/e1/history?limit=3");
  });

  it("sends only the fields the payment route understands", async () => {
    const call = await callOf("mark_payment", { eventId: "e1", playerName: "Ada", status: "paid", playerId: "ignored" });
    expect(call.body).toEqual({ playerName: "Ada", status: "paid", method: undefined });
  });

  it("defaults post_result's lineup to the event's current teams", async () => {
    const event = await prisma.event.create({
      data: {
        id: "hist-e1",
        title: "Test",
        location: "Retiro",
        dateTime: new Date("2026-10-07T19:00:00Z"),
        teamOneName: "A",
        teamTwoName: "B",
        teamResults: {
          create: [
            { name: "A", members: { create: [{ name: "Ada", order: 0 }] } },
            { name: "B", members: { create: [{ name: "Bob", order: 0 }] } },
          ],
        },
      },
    });
    const call = await callOf("post_result", { eventId: event.id, scoreOne: 3, scoreTwo: 1 });
    expect(call.path).toBe("/api/events/hist-e1/history");
    const body = call.body as Record<string, unknown>;
    expect(body.teamOneName).toBe("A");
    expect(body.scoreOne).toBe(3);
    expect(JSON.parse(String(body.teamsSnapshot))).toEqual([
      { team: "A", players: [{ name: "Ada", order: 0 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }] },
    ]);
  });

  it("lets an explicit post_result lineup win over the current teams", async () => {
    const event = await prisma.event.create({
      data: { id: "hist-e2", title: "T", location: "Retiro", dateTime: new Date() },
    });
    const override = [{ team: "X", players: [{ name: "Ada", order: 0 }] }];
    const call = await callOf("post_result", { eventId: event.id, scoreOne: 0, scoreTwo: 0, teamsSnapshot: override });
    expect(JSON.parse(String((call.body as any).teamsSnapshot))).toEqual(override);
  });
});

// ───────────────────────────── HTTP route ───────────────────────────────────

describe("POST /api/mcp", () => {
  beforeEach(async () => {
    const client = await prisma.oauthClient.create({
      data: { id: crypto.randomUUID(), clientId: "mcp-client", redirectUris: "", type: "web" },
    });
    await prisma.user.create({ data: { id: "u-mcp", name: "Ada", email: "ada@example.com" } });
    await prisma.oauthAccessToken.create({
      data: {
        id: crypto.randomUUID(),
        token: TOKEN,
        clientId: client.clientId,
        userId: "u-mcp",
        scopes: "read:events manage:teams",
      },
    });
  });

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    mcpPost({
      request: new Request("http://localhost:4321/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    } as never);

  it("401s without credentials and advertises the discovery document", async () => {
    const res = await mcpPost({
      request: new Request("http://localhost:4321/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rpc("tools/list")),
      }),
    } as never);
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain("Bearer");
    expect(challenge).toContain("/.well-known/oauth-protected-resource/api/mcp");
  });

  it("uses the forwarded host for the challenge so it points at the public origin", async () => {
    const res = await mcpPost({
      request: new Request("http://10.0.0.5:3000/api/mcp", {
        method: "POST",
        headers: { "x-forwarded-host": "convocados.cabeda.dev", "x-forwarded-proto": "https" },
        body: JSON.stringify(rpc("tools/list")),
      }),
    } as never);
    expect(res.headers.get("www-authenticate")).toContain("https://convocados.cabeda.dev/.well-known");
  });

  it("serves tools/list to an authenticated caller", async () => {
    const res = await post(rpc("tools/list"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const { result, jsonrpc, id } = await res.json();
    expect(jsonrpc).toBe("2.0");
    expect(id).toBe(1);
    expect(result.tools.length).toBe(MCP_TOOLS.length);
  });

  it("returns a JSON-RPC parse error for a malformed body", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(200);
    expect((await res.json()).error.code).toBe(RPC.PARSE_ERROR);
  });

  it("dispatches a tool call against the internal listener, not the public origin", async () => {
    const { impl, calls } = fakeFetch({ ok: true });
    vi.stubGlobal("fetch", impl);
    const res = await post(rpc("tools/call", { name: "get_event", arguments: { eventId: "e1" } }));
    expect((await res.json()).result.isError).toBe(false);
    expect(calls[0].url).toBe("http://localhost:4321/api/events/e1");
    vi.unstubAllGlobals();
  });

  it("returns 202 with no body for a notification", async () => {
    const res = await post(rpc("notifications/initialized", undefined, undefined));
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("echoes a client-supplied Mcp-Session-Id but never mints one", async () => {
    const withSession = await post(rpc("ping"), { "mcp-session-id": "sess-1" });
    expect(withSession.headers.get("mcp-session-id")).toBe("sess-1");
    const stateless = await post(rpc("ping"));
    expect(stateless.headers.get("mcp-session-id")).toBeNull();
  });

  it("replays a session cookie when the caller authenticated by cookie", async () => {
    // Browser-based MCP clients (same-origin) carry a session, not a bearer.
    // Without this the outer request authenticates but every tool call 401s.
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u-mcp" } } as never);
    const { impl, calls } = fakeFetch({ ok: true });
    vi.stubGlobal("fetch", impl);
    const res = await mcpPost({
      request: new Request("http://localhost:4321/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "better-auth.session_token=abc" },
        body: JSON.stringify(rpc("tools/call", { name: "get_event", arguments: { eventId: "e1" } })),
      }),
    } as never);
    expect((await res.json()).result.isError).toBe(false);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.cookie).toBe("better-auth.session_token=abc");
    expect(headers.authorization).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("falls back to the request URL when no host header is present", async () => {
    const res = await mcpPost({
      request: new Request("http://internal.local:3000/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rpc("tools/list")),
      }),
    } as never);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("http://internal.local:3000/.well-known");
  });

  it("refuses GET and DELETE: stateless servers offer no stream or session", async () => {
    const req = new Request("http://localhost:4321/api/mcp", {
      method: "GET",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const getRes = await mcpGet({ request: req } as never);
    expect(getRes.status).toBe(405);
    expect(getRes.headers.get("allow")).toBe("POST");
    expect((await mcpDelete({ request: req } as never)).status).toBe(405);
  });
});

// ───────────────────────────── RFC 9728 ─────────────────────────────────────

describe("GET /.well-known/oauth-protected-resource/api/mcp", () => {
  it("declares the resource, issuer, scopes and bearer method", async () => {
    const res = await prMetadata({
      url: new URL("http://localhost:4321/.well-known/oauth-protected-resource/api/mcp"),
      request: new Request("http://localhost:4321/.well-known/oauth-protected-resource/api/mcp"),
    } as never);
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.resource).toBe("http://localhost:4321/api/mcp");
    expect(doc.authorization_servers).toEqual(["http://localhost:4321"]);
    expect(doc.bearer_methods_supported).toEqual(["header"]);
    expect(doc.scopes_supported).toContain("manage:teams");
    expect(doc.scopes_supported).toContain("openid");
  });

  it("reports the public origin when behind a proxy", async () => {
    const res = await prMetadata({
      url: new URL("http://10.0.0.5:3000/.well-known/oauth-protected-resource/api/mcp"),
      request: new Request("http://10.0.0.5:3001/.well-known/oauth-protected-resource/api/mcp", {
        headers: { "x-forwarded-host": "convocados.cabeda.dev", "x-forwarded-proto": "https" },
      }),
    } as never);
    expect((await res.json()).resource).toBe("https://convocados.cabeda.dev/api/mcp");
  });
});