import type { APIRoute } from "astro";
import { authenticateRequest, requireScope } from "../../lib/authenticate.server";
import { TOOLS } from "../../lib/mcp/tools";

const PROTOCOL_VERSION = "2026-07-28";

function jsonRpcError(id: unknown, code: number, message: string, data?: unknown, status = 400) {
  const body: Record<string, unknown> = {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
  return Response.json(body, { status });
}

function jsonRpcResult(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result }, { status: 200 });
}

export const GET: APIRoute = async () => {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        message: "Use POST with MCP-Protocol-Version and Mcp-Method headers. SSE is deprecated; see server/discover.",
        data: { hint: "POST /api/mcp with headers MCP-Protocol-Version: 2026-07-28, Mcp-Method, Mcp-Name" },
      },
    },
    { status: 405, headers: { Allow: "POST" } }
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

  // ── Header validation (SEP-2243 + stateless core) ────────────────────────
  const protocolVersion = request.headers.get("MCP-Protocol-Version");
  if (!protocolVersion) {
    return jsonRpcError(id, -32600, "Missing MCP-Protocol-Version header");
  }
  if (protocolVersion !== PROTOCOL_VERSION) {
    return jsonRpcError(id, -32600, `Unsupported MCP-Protocol-Version: ${protocolVersion}. Expected ${PROTOCOL_VERSION}`);
  }

  const mcpMethod = request.headers.get("Mcp-Method");
  if (!mcpMethod) {
    return jsonRpcError(id, -32600, "Missing Mcp-Method header");
  }
  if (method && mcpMethod !== method) {
    return jsonRpcError(id, -32600, `Mcp-Method mismatch: header "${mcpMethod}" != body method "${method}"`);
  }

  // ── Retired initialize ───────────────────────────────────────────────────
  if (method === "initialize" || mcpMethod === "initialize") {
    return jsonRpcError(id, -32601, "initialize is retired in 2026-07-28, use server/discover", { hint: "Call server/discover instead of initialize" });
  }

  // ── server/discover (no auth required, optional) ────────────────────────
  if (method === "server/discover" || mcpMethod === "server/discover") {
    return jsonRpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: "convocados", version: "3.128.6" },
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
      },
      instructions: "Stateless MCP 2026-07-28. Each request is self-describing. Use tools/list and tools/call with Mcp-Method/Mcp-Name headers.",
    });
  }

  // ── Auth required for tools ─────────────────────────────────────────────
  const needsAuth = mcpMethod === "tools/list" || mcpMethod === "tools/call" || method === "tools/list" || method === "tools/call";
  let authCtx: Awaited<ReturnType<typeof authenticateRequest>> = null;
  if (needsAuth) {
    authCtx = await authenticateRequest(request);
    if (!authCtx) {
      return jsonRpcError(id, -32001, "Unauthorized: missing or invalid Bearer token", undefined, 401);
    }
  }

  // ── tools/list ───────────────────────────────────────────────────────────
  if (method === "tools/list" || mcpMethod === "tools/list") {
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
  if (method === "tools/call" || mcpMethod === "tools/call") {
    const params = body?.params ?? {};
    const name: string | undefined = params.name;
    const args: Record<string, unknown> = (params.arguments ?? {}) as Record<string, unknown>;

    const mcpName = request.headers.get("Mcp-Name");
    if (!mcpName) {
      return jsonRpcError(id, -32600, "Missing Mcp-Name header for tools/call");
    }
    if (name && mcpName !== name) {
      return jsonRpcError(id, -32600, `Mcp-Name mismatch: header "${mcpName}" != params.name "${name}"`);
    }
    const toolName = name ?? mcpName;
    if (!toolName) {
      return jsonRpcError(id, -32602, "Missing tool name");
    }

    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) {
      return jsonRpcError(id, -32601, `Tool not found: ${toolName}`, undefined, 404);
    }

    // scope check
    if (!requireScope(authCtx!, tool.scope)) {
      return jsonRpcError(id, -32001, `Forbidden: missing scope ${tool.scope}`, undefined, 403);
    }

    try {
      const data = await tool.handler(args, authCtx!);
      return jsonRpcResult(id, {
        content: [{ type: "text" as const, text: JSON.stringify(data) }],
      });
    } catch (err: any) {
      const code = typeof err.code === "number" ? err.code : -32603;
      const status = err.code === 404 ? 404 : 500;
      if (err.code === 404) {
        return jsonRpcError(id, -32001, err.message ?? "Not found", undefined, 404);
      }
      if (err.code === -32602) {
        return jsonRpcError(id, -32602, err.message ?? "Invalid params");
      }
      return jsonRpcError(id, code, err.message ?? "Internal error", undefined, status);
    }
  }

  return jsonRpcError(id, -32601, `Method not found: ${method ?? mcpMethod}`);
};
