import type { APIRoute } from "astro";
import { authenticateRequest } from "~/lib/authenticate.server";
import { handleRpc, RPC } from "~/lib/mcp/server";
import { MCP_TOOLS } from "~/lib/mcp/tools";

/**
 * Scopes an MCP client should request to be able to call everything.
 * Derived from the tool table so adding a scoped tool cannot drift the challenge.
 */
const TOOL_SCOPES = [...new Set(MCP_TOOLS.map((tool) => tool.scope))].filter(Boolean).join(" ");

/**
 * Public origin as seen by the MCP client. Behind Fly's proxy `request.url`
 * carries the internal address, so prefer the forwarded headers.
 */
function publicOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

/**
 * MCP Streamable HTTP transport, stateless.
 *
 * Every POST re-authenticates from the bearer token, so no session state lives
 * here and the endpoint survives machine suspend/restart. The spec explicitly
 * permits stateless servers; the cost is that server-initiated messages
 * (sampling, notifications) are unavailable, which this app does not use.
 */
export const POST: APIRoute = async ({ request }) => {
  const origin = publicOrigin(request);

  const auth = await authenticateRequest(request);
  if (!auth) {
    // Point unauthenticated clients at the discovery document per RFC 9728.
    return Response.json(
      { error: "Authentication required. See /.well-known/oauth-protected-resource for the OAuth flow." },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", scope="${TOOL_SCOPES}"`,
        },
      },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: RPC.PARSE_ERROR, message: "Body must be valid JSON." } },
      { status: 200, headers: jsonHeaders(request) },
    );
  }

  // Replay the caller's own credential on the internal call. MCP clients may
  // arrive with a bearer token *or* a session cookie (same-origin browser
  // clients), and the target route re-runs the same auth check either way.
  const authHeaders: Record<string, string> = {};
  const authorization = request.headers.get("authorization");
  if (authorization) authHeaders.authorization = authorization;
  const cookie = request.headers.get("cookie");
  if (cookie) authHeaders.cookie = cookie;

  // Internal dispatch targets this very listener, so the request URL's origin is
  // correct even when it differs from the public origin.
  const outcome = await handleRpc(payload, { auth, origin: new URL(request.url).origin, authHeaders });

  const headers = jsonHeaders(request);
  if (outcome.body === null) return new Response(null, { status: outcome.status, headers });
  return new Response(JSON.stringify(outcome.body), { status: outcome.status, headers });
};

/** Stateless: no SSE stream and no session to terminate. Both are spec-optional. */
const notSupported: APIRoute = ({ request }) =>
  Response.json(
    { error: "This MCP server is stateless: only POST (JSON-RPC) is supported." },
    { status: 405, headers: { allow: "POST", ...jsonHeaders(request) } },
  );

export const GET = notSupported;
export const DELETE = notSupported;

/** Echo a client-supplied Mcp-Session-Id; minting one is optional when stateless. */
function jsonHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sessionId = request.headers.get("mcp-session-id");
  if (sessionId) headers["mcp-session-id"] = sessionId;
  return headers;
}
