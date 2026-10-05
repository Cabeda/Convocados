import { MCP_TOOLS, MCP_TOOLS_BY_NAME, type McpTool } from "./tools";
import { requireScope, type AuthContext } from "~/lib/authenticate.server";

/** Latest MCP revision this server implements. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** Revisions accepted from a client during `initialize` (negotiated, not refused). */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export const MCP_SERVER_NAME = "convocados";

export function mcpServerVersion(): string {
  // ponytail: read once, tolerate a missing version field rather than importing
  // package.json (which would need resolveJsonModule in the server build).
  const version = process.env.npm_package_version;
  return version && version !== "0.0.0" ? version : "dev";
}

/** JSON-RPC 2.0 codes plus the MCP-specific range used for auth failures. */
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32002,
} as const;

export interface JsonRpcMessage {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

export interface RpcOutcome {
  status: number;
  /** null → respond with no body (notification). */
  body: unknown;
}

const ok = (id: string | number | null, result: unknown): RpcOutcome => ({
  status: 200,
  body: { jsonrpc: "2.0", id, result },
});

const fail = (id: string | number | null, code: number, message: string): RpcOutcome => ({
  status: 200,
  body: { jsonrpc: "2.0", id, error: { code, message } },
});

const noContent = (): RpcOutcome => ({ status: 202, body: null });

/**
 * MCP tool-execution failures are *results* with isError:true, not JSON-RPC
 * errors — that is what lets the model see the message and retry instead of
 * the client tearing down the call.
 */
const toolError = (id: string | number | null, text: string): RpcOutcome =>
  ok(id, { content: [{ type: "text", text }], isError: true });

/** Cap tool output so a 100-player event cannot blow out the model's context. */
const MAX_TOOL_TEXT = 50_000;

const pretty = (value: unknown): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > MAX_TOOL_TEXT
    ? `${text.slice(0, MAX_TOOL_TEXT)}\n… truncated at ${MAX_TOOL_TEXT} chars.`
    : text;
};

/** Wire shape of an entry in a `tools/list` response. */
export function listTools() {
  return MCP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations ?? {},
  }));
}

/**
 * Trust-boundary validation: the MCP spec makes the client validate, but the
 * server must not rely on it. Checks required keys and enum membership only —
 * unknown extra keys are ignored rather than rejected, because the underlying
 * REST route is the real validator and already ignores them.
 */
export function validateArgs(
  tool: McpTool,
  raw: unknown,
): { ok: true; args: Record<string, unknown> } | { ok: false; message: string } {
  if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) {
    return { ok: false, message: `Tool "${tool.name}" expects a JSON object of arguments.` };
  }
  // `arguments` is optional in MCP, so an absent value means "no arguments".
  const args = (raw ?? {}) as Record<string, unknown>;
  const schema = tool.inputSchema as {
    required?: string[];
    properties?: Record<string, { enum?: readonly unknown[] }>;
  };

  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null) {
      return { ok: false, message: `Tool "${tool.name}" is missing required argument "${key}".` };
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const allowed = schema.properties?.[key]?.enum;
    if (value === undefined || !allowed) continue;
    if (!allowed.includes(value)) {
      return {
        ok: false,
        message: `Argument "${key}" must be one of: ${allowed.map(String).join(", ")} (got ${JSON.stringify(value)}).`,
      };
    }
  }

  return { ok: true, args };
}

const INSTRUCTIONS = [
  "Convocados organises recurring pickup sports games.",
  "Typical flow: list_events or get_event to find an eventId, then act on it.",
  "Player self-service actions (rsvp, claim_player, leave_event, follow_event) act as the",
  "connected user and need no special scope. Organiser actions require write, manage or",
  "create scopes; call whoami to check which account a token is bound to.",
  "Teams and payments are only writable by the event owner or an event admin — a 403 from",
  "those tools is a permission outcome, not a bug. If the event has no teams yet, call",
  "randomize_teams before post_result.",
].join(" ");

export interface DispatchDeps {
  auth: AuthContext;
  /** Origin of this server, used to build the internal fetch target. */
  origin: string;
  /**
   * Credential headers to replay on the internal call. Carries the caller's
   * bearer token, or their session cookie for cookie-authenticated clients —
   * the target route re-runs the same auth check either way.
   */
  authHeaders: Record<string, string>;
  /** Injected for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Handle one JSON-RPC message. Auth is assumed to have happened already — this
 * function owns protocol concerns only.
 */
export async function handleRpc(raw: unknown, deps: DispatchDeps): Promise<RpcOutcome> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return fail(null, RPC.INVALID_REQUEST, "Body must be a single JSON-RPC object.");
  }

  const msg = raw as JsonRpcMessage;
  const isNotification = msg.id === undefined || msg.id === null;
  const id = typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null;

  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return isNotification ? noContent() : fail(id, RPC.INVALID_REQUEST, 'Expected { "jsonrpc": "2.0", "method": ... }.');
  }

  switch (msg.method) {
    case "initialize": {
      const params = (msg.params ?? {}) as { protocolVersion?: unknown };
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : MCP_PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, version: mcpServerVersion() },
        instructions: INSTRUCTIONS,
      });
    }

    // Notifications carry no id and get no response.
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/progress":
      return noContent();

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, { tools: listTools() });

    case "tools/call":
      return callTool(msg.params, deps, id);

    default:
      return isNotification
        ? noContent()
        : fail(id, RPC.METHOD_NOT_FOUND, `Unknown method "${msg.method}".`);
  }
}

async function callTool(params: unknown, deps: DispatchDeps, id: string | number | null): Promise<RpcOutcome> {
  const p = (params ?? {}) as { name?: unknown; arguments?: unknown };

  if (typeof p.name !== "string" || p.name.length === 0) {
    return fail(id, RPC.INVALID_PARAMS, "tools/call requires params.name.");
  }

  const tool = MCP_TOOLS_BY_NAME.get(p.name);
  if (!tool) {
    const available = MCP_TOOLS.map((t) => t.name).join(", ");
    return fail(id, RPC.INVALID_PARAMS, `Unknown tool "${p.name}". Available tools: ${available}.`);
  }

  if (tool.scope && !requireScope(deps.auth, tool.scope)) {
    return fail(
      id,
      RPC.FORBIDDEN,
      `Tool "${tool.name}" requires the "${tool.scope}" scope, which this token was not granted.`,
    );
  }

  const validated = validateArgs(tool, p.arguments);
  if (!validated.ok) return fail(id, RPC.INVALID_PARAMS, validated.message);

  let call;
  try {
    call = await tool.call(validated.args, { userId: deps.auth.userId });
  } catch (err) {
    return toolError(id, `${tool.name} failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const doFetch = deps.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    ...deps.authHeaders,
    accept: "application/json",
  };
  if (call.body !== undefined && call.method !== "GET") {
    headers["content-type"] = "application/json";
  }

  try {
    const res = await doFetch(new URL(call.path, deps.origin), {
      method: call.method,
      headers,
      ...(call.body !== undefined && call.method !== "GET" ? { body: JSON.stringify(call.body) } : {}),
    });
    const text = await res.text();
    let payload: unknown = text;
    try {
      payload = JSON.parse(text);
    } catch {
      /* not JSON — surface the raw body */
    }

    if (!res.ok) {
      return toolError(id, `${call.method} ${call.path} → HTTP ${res.status}\n${pretty(payload)}`);
    }
    return ok(id, { content: [{ type: "text", text: pretty(payload) }], isError: false });
  } catch (err) {
    return toolError(id, `${tool.name} could not reach the API: ${err instanceof Error ? err.message : String(err)}`);
  }
}