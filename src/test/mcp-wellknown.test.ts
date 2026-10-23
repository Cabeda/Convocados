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

  it("publishes one issuer: PRM authorization_servers, metadata issuer and iss agree (#1501)", async () => {
    const prmReq = new Request("http://localhost:4321/.well-known/oauth-protected-resource");
    const prm: any = await (await ProtectedGET({ request: prmReq, url: new URL(prmReq.url) } as any)).json();

    const mdReq = new Request("http://localhost:4321/.well-known/oauth-authorization-server");
    const md: any = await (await AuthServerGET({ request: mdReq, url: new URL(mdReq.url) } as any)).json();

    expect(prm.authorization_servers[0]).toBe(md.issuer);
    // The issuer is an origin, not an origin plus the auth handler's path:
    // a path-suffixed issuer is what Claude.ai refused to trust.
    expect(new URL(md.issuer).pathname).toBe("/");
  });
});
