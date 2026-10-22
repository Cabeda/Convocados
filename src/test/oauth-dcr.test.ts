/**
 * Dynamic Client Registration (RFC 7591) — the MCP connector path.
 *
 * An MCP client (Claude.ai, ChatGPT, any third-party agent) registers itself
 * against the authorization server *server-side*: the connector's backend
 * POSTs to `/api/auth/oauth2/register` with no session cookie and no bearer
 * token. If the AS requires a session to register, the whole OAuth flow dies
 * before the user ever sees a login page — which is what Claude.ai reports as
 * "Authentication failed".
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const { POST: registerHandler } = await import("~/pages/api/auth/oauth2/register");

const REGISTER_URL = "http://localhost:4321/api/auth/oauth2/register";

/** A registration exactly as an MCP connector backend sends it. */
function registrationRequest(overrides: Record<string, unknown> = {}) {
  return new Request(REGISTER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_uri: "https://claude.ai",
      scope: "openid profile email read:events create:events",
      ...overrides,
    }),
  });
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.$executeRawUnsafe("DELETE FROM oauthClient");
});

describe("OAuth DCR — MCP clients register themselves", () => {
  it("registers a public client without a session or bearer token", async () => {
    const res = await registerHandler({ request: registrationRequest() } as any);

    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.client_id).toBeTruthy();
    expect(body.redirect_uris).toContain("https://claude.ai/api/mcp/auth_callback");

    // The client is usable: a public client with no secret and PKCE required.
    const client = await prisma.oauthClient.findFirst({ where: { clientId: body.client_id } });
    expect(client).not.toBeNull();
  });

  it("still refuses the client_credentials grant for an unauthenticated registration", async () => {
    // Open registration must not open the machine-to-machine grant: that one
    // is for trusted, pre-registered clients only.
    const res = await registerHandler({
      request: registrationRequest({ grant_types: ["client_credentials"] }),
    } as any);

    expect(res.status).toBe(400);
  });
});
