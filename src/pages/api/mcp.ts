import type { APIRoute } from "astro";
import { authenticateRequest, requireScope, type AuthContext } from "../../lib/authenticate.server";
import { checkApiRateLimit, extractIp } from "../../lib/apiRateLimit.server";
import { TOOLS } from "../../lib/mcp/tools";
import { McpError } from "../../lib/mcp/errors";
import {
  MODERN_VERSION,
  SERVER_INFO,
  SERVER_CAPABILITIES,
  SERVER_INSTRUCTIONS,
  isSupportedVersion,
  negotiateHandshakeVersion,
  wwwAuthenticate,
} from "../../lib/mcp/protocol";

/** Explicit empty context for tools that allow anonymous callers. */
const ANONYMOUS_CTX: AuthContext = { userId: "", scopes: [], authMethod: "oauth" };

function jsonRpcError(
  id: unknown,
  code: number,
  message: string,
  data?: unknown,
  status = 400,
  headers: Record<string, string> = {},
) {
  const body: Record<string, unknown> = {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
  return Response.json(body, { status, headers });
}

function jsonRpcResult(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result }, { status: 200 });
}

/** JSON-RPC notification — no response body (Streamable HTTP: 202 Accepted). */
function accepted() {
  return new Response(null, { status: 202 });
}

function originOf(request: Request): string {
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "convocados.cabeda.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

/**
 * Streamable HTTP GET is only for server-initiated messages, which this server
 * does not send. 405 with `Allow: POST` is the spec-tolerable answer.
 */
export const GET: APIRoute = async () => {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        message: "Use POST for MCP requests. This server sends no unsolicited messages.",
        data: { hint: "POST /api/mcp with a JSON-RPC body" },
      },
    },
    { status: 405, headers: { Allow: "POST" } },
  );
};

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error: invalid JSON");
  }

  const id = body?.id ?? null;
  const method = body?.method as string | undefined;

  // ── Optional headers (legacy stateless routing). Never required. ─────────
  const headerVersion = request.headers.get("MCP-Protocol-Version");
  if (headerVersion && !isSupportedVersion(headerVersion)) {
    return jsonRpcError(id, -32600, `Unsupported MCP-Protocol-Version: ${headerVersion}`);
  }
  const metaVersion = body?.params?._meta?.["io.modelcontextprotocol/protocolVersion"] as
    | string
    | undefined;
  if (!headerVersion && metaVersion && !isSupportedVersion(metaVersion)) {
    return jsonRpcError(id, -32600, `Unsupported MCP-Protocol-Version: ${metaVersion}`);
  }
  const mcpMethod = request.headers.get("Mcp-Method");
  if (mcpMethod && method && mcpMethod !== method) {
    return jsonRpcError(id, -32600, `Mcp-Method mismatch: header "${mcpMethod}" != body method "${method}"`);
  }
  const effectiveMethod = method ?? mcpMethod;

  // ── Handshake era: initialize ────────────────────────────────────────────
  if (effectiveMethod === "initialize") {
    const clientVersion = body?.params?.protocolVersion as string | undefined;
    return jsonRpcResult(id, {
      protocolVersion: negotiateHandshakeVersion(clientVersion),
      capabilities: SERVER_CAPABILITIES,
      serverInfo: SERVER_INFO,
      instructions: SERVER_INSTRUCTIONS,
    });
  }

  // Any notification gets 202 with no body.
  if (effectiveMethod?.startsWith("notifications/")) {
    return accepted();
  }

  if (effectiveMethod === "ping") {
    return jsonRpcResult(id, {});
  }

  // ── Modern era: server/discover (no auth) ────────────────────────────────
  if (effectiveMethod === "server/discover") {
    return jsonRpcResult(id, {
      protocolVersion: MODERN_VERSION,
      serverInfo: SERVER_INFO,
      capabilities: SERVER_CAPABILITIES,
      instructions: SERVER_INSTRUCTIONS,
    });
  }

  const isToolsList = effectiveMethod === "tools/list";
  const isToolsCall = effectiveMethod === "tools/call";

  // ── Rate limiting (mutations metered; tools/list is cheap) ───────────────
  if (isToolsList || isToolsCall) {
    const preset = isToolsCall ? "write" : "read";
    const ip = extractIp(request);
    const { allowed, retryAfterMs } = await checkApiRateLimit(ip, preset);
    if (!allowed) {
      return jsonRpcError(id, -32000, "Too many requests. Please try again later.", undefined, 429, {
        "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
      });
    }
  }

  // ── tools/list — anonymous (MCP mixed authentication) ────────────────────
  if (isToolsList) {
    const tools = TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    return jsonRpcResult(id, {
      tools,
      _meta: { ttlMs: 60000, cacheScope: "global" as const },
    });
  }

  // ── tools/call ───────────────────────────────────────────────────────────
  if (isToolsCall) {
    const params = body?.params ?? {};
    const name: string | undefined = params.name;
    const args: Record<string, unknown> = (params.arguments ?? {}) as Record<string, unknown>;
    const mcpName = request.headers.get("Mcp-Name");
    if (mcpName && name && mcpName !== name) {
      return jsonRpcError(id, -32600, `Mcp-Name mismatch: header "${mcpName}" != params.name "${name}"`);
    }
    const toolName = name ?? mcpName;
    if (!toolName) {
      return jsonRpcError(id, -32602, "Missing tool name (params.name)");
    }

    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) {
      return jsonRpcError(id, -32601, `Tool not found: ${toolName}`, undefined, 404);
    }

    // Mixed auth: anonymous read tools need no token; everything else does.
    const requiresAuth = tool.requiresAuth !== false;
    let authCtx: AuthContext | null = null;
    if (requiresAuth || request.headers.get("authorization")) {
      authCtx = await authenticateRequest(request);
    }
    if (requiresAuth && !authCtx) {
      return jsonRpcError(id, -32001, "Unauthorized: missing or invalid Bearer token", undefined, 401, {
        "WWW-Authenticate": wwwAuthenticate(originOf(request), tool.scope),
      });
    }
    if (authCtx && !requireScope(authCtx, tool.scope)) {
      return jsonRpcError(id, -32001, `Forbidden: missing scope ${tool.scope}`, undefined, 403);
    }

    try {
      const data = await tool.handler(args, authCtx ?? ANONYMOUS_CTX);
      return jsonRpcResult(id, {
        content: [{ type: "text" as const, text: JSON.stringify(data) }],
      });
    } catch (err: unknown) {
      if (err instanceof McpError) {
        return jsonRpcError(id, err.code, err.message, err.data, err.status);
      }
      const message = err instanceof Error ? err.message : "Internal error";
      return jsonRpcError(id, -32603, message, undefined, 500);
    }
  }

  return jsonRpcError(id, -32601, `Method not found: ${effectiveMethod ?? "unknown"}`);
};
