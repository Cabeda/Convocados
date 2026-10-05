import type { APIRoute } from "astro";
import { OAUTH_SCOPES } from "~/lib/scopes";

/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata.
 *
 * This is the document an MCP client fetches to discover *where* to authorize
 * before calling POST /api/mcp. Path-suffix form: the resource path
 * `/api/mcp` is appended to `/.well-known/oauth-protected-resource`.
 */
export const GET: APIRoute = ({ url, request }) => {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const issuer = `${proto}://${host}`;

  return Response.json(
    {
      resource: `${issuer}/api/mcp`,
      authorization_servers: [issuer],
      scopes_supported: OAUTH_SCOPES,
      bearer_methods_supported: ["header"],
      resource_documentation: "https://webmcp.dev/",
    },
    {
      headers: {
        // Discovery documents are safe to cache briefly; keeps clients from
        // hammering this endpoint while still picking up config changes.
        "cache-control": "public, max-age=300",
      },
    },
  );
};