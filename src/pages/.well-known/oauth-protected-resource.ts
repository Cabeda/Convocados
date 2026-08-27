import type { APIRoute } from "astro";
import { OAUTH_SCOPES } from "../../lib/scopes";

const BASE = process.env.BETTER_AUTH_URL ?? "https://convocados.cabeda.dev";

export const GET: APIRoute = async ({ url }) => {
  // RFC 9728: client may query with ?resource= to discover metadata for a specific resource.
  // Echo back the requested resource if it matches our MCP endpoint, otherwise return canonical.
  const requested = url.searchParams.get("resource");
  const canonical = `${BASE}/api/mcp`;
  const resource = requested && requested.startsWith(BASE) ? requested : canonical;
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
