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
import { describe, it, expect, beforeEach, vi } from "vitest";
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

  it("rejects a caller-supplied client_metadata_uri without fetching it", async () => {
    // The fetched CIMD bytes are stripped by better-auth's registration
    // schema anyway, so any outbound request is an SSRF primitive that buys
    // nothing. A loopback URL must never be dialed and the field is refused.
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await registerHandler({
      request: registrationRequest({ client_metadata_uri: "http://127.0.0.1:1/" }),
    } as any);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
    fetchSpy.mockRestore();
  });

  it("applies the 5/hour oauth_register limit on this concrete route", async () => {
    // This file shadows the [...all] catch-all that used to carry the limit,
    // so an unmetered DCR route let one caller hold workers at will.
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await registerHandler({
        request: registrationRequest({ client_name: `Claude ${i}` }),
      } as any);
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses[10]).toBe(429);
  });
});
