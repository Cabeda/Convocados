import type { APIRoute } from "astro";

const BASE = process.env.BETTER_AUTH_URL ?? "https://convocados.cabeda.dev";

export const GET: APIRoute = async () => {
  // RFC 8414 authorization server metadata with RFC 9207 iss
  return Response.json({
    issuer: BASE,
    authorization_endpoint: `${BASE}/api/auth/oauth2/authorize`,
    token_endpoint: `${BASE}/api/auth/oauth2/token`,
    registration_endpoint: `${BASE}/api/auth/oauth2/register`,
    userinfo_endpoint: `${BASE}/api/auth/oauth2/userinfo`,
    introspection_endpoint: `${BASE}/api/auth/oauth2/introspect`,
    revocation_endpoint: `${BASE}/api/auth/oauth2/revoke`,
    jwks_uri: `${BASE}/api/auth/jwks`,
    scopes_supported: ["openid", "profile", "email", "offline_access", "read:events", "write:events", "create:events", "manage:players", "read:ratings", "read:history", "manage:teams", "manage:webhooks", "manage:push", "read:calendar", "manage:payments"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    // RFC 9207 issuer parameter
    issuer_identification: true,
  }, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
};
