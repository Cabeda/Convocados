import type { APIRoute } from "astro";
import { OAUTH_SCOPES } from "../../lib/scopes";

const BASE = process.env.BETTER_AUTH_URL ?? "https://convocados.cabeda.dev";

export const GET: APIRoute = async ({ url }) => {
  const resource = `${BASE}/api/mcp`;
  // RFC 9728 protected resource metadata
  return Response.json({
    resource,
    authorization_servers: [BASE],
    bearer_methods_supported: ["header"],
    scopes_supported: OAUTH_SCOPES,
    resource_name: "Convocados MCP",
    resource_documentation: `${BASE}/api/mcp`,
  }, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
};
