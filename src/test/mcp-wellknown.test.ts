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

  it("advertises the metadata's own issuer, so clients find one issuer and one document", async () => {
    // Claude refuses a connector when the `iss` the server returns differs from
    // the issuer in the metadata it read. It reads that metadata from
    // `authorization_servers[0]`, so the two must be the same string.
    const prmReq = new Request("http://localhost:4321/.well-known/oauth-protected-resource");
    const prm: any = await (await ProtectedGET({ request: prmReq, url: new URL(prmReq.url) } as any)).json();
    const mdReq = new Request("http://localhost:4321/.well-known/oauth-authorization-server");
    const metadata: any = await (await AuthServerGET({ request: mdReq, url: new URL(mdReq.url) } as any)).json();

    expect(prm.authorization_servers).toEqual([metadata.issuer]);
    // No path component: the document is published at the origin root, so the
    // issuer must be the origin root too (RFC 8414 §3.3).
    expect(new URL(metadata.issuer).pathname).toBe("/");
  });
});
