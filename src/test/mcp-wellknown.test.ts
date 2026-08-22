import { describe, it, expect } from "vitest";
import { GET as ProtectedGET } from "~/pages/.well-known/oauth-protected-resource";
import { GET as AuthServerGET } from "~/pages/.well-known/oauth-authorization-server/index";

describe("well-known MCP metadata", () => {
  it("GET /.well-known/oauth-protected-resource returns resource metadata", async () => {
    const req = new Request("http://localhost:4321/.well-known/oauth-protected-resource");
    const res = await ProtectedGET({ request: req, url: new URL(req.url) } as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.resource).toMatch(/\/api\/mcp/);
    expect(body.authorization_servers).toBeDefined();
    expect(body.bearer_methods_supported).toContain("header");
    expect(body.scopes_supported).toContain("read:events");
  });

  it("GET /.well-known/oauth-authorization-server returns issuer with RFC 9207", async () => {
    const req = new Request("http://localhost:4321/.well-known/oauth-authorization-server");
    const res = await AuthServerGET({ request: req, url: new URL(req.url) } as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.issuer).toBeDefined();
    expect(body.authorization_endpoint).toMatch(/oauth2\/authorize/);
    expect(body.token_endpoint).toMatch(/oauth2\/token/);
    expect(body.code_challenge_methods_supported).toContain("S256");
  });
});
