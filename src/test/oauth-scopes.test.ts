import { describe, it, expect } from "vitest";
import {
  APP_SCOPES,
  OIDC_SCOPES,
  OAUTH_SCOPES,
  SCOPE_DESCRIPTIONS,
  hasScope,
  hasAllScopes,
} from "~/lib/scopes";

describe("Scopes module", () => {
  it("APP_SCOPES contains all expected application scopes", () => {
    expect(APP_SCOPES).toContain("read:events");
    expect(APP_SCOPES).toContain("write:events");
    expect(APP_SCOPES).toContain("create:events");
    expect(APP_SCOPES).toContain("manage:players");
    expect(APP_SCOPES).toContain("read:profile");
    expect(APP_SCOPES).toContain("read:ratings");
    expect(APP_SCOPES).toContain("read:history");
    expect(APP_SCOPES).toContain("manage:teams");
    expect(APP_SCOPES).toContain("manage:webhooks");
    expect(APP_SCOPES).toContain("manage:push");
    expect(APP_SCOPES).toContain("read:calendar");
    expect(APP_SCOPES).toContain("manage:payments");
  });

  it("OIDC_SCOPES contains standard OIDC scopes", () => {
    expect(OIDC_SCOPES).toContain("openid");
    expect(OIDC_SCOPES).toContain("profile");
    expect(OIDC_SCOPES).toContain("email");
    expect(OIDC_SCOPES).toContain("offline_access");
  });

  it("OAUTH_SCOPES is the union of OIDC + APP scopes", () => {
    for (const s of OIDC_SCOPES) expect(OAUTH_SCOPES).toContain(s);
    for (const s of APP_SCOPES) expect(OAUTH_SCOPES).toContain(s);
    expect(OAUTH_SCOPES.length).toBe(OIDC_SCOPES.length + APP_SCOPES.length);
  });

  it("every scope has a human-readable description", () => {
    for (const s of OAUTH_SCOPES) {
      expect(SCOPE_DESCRIPTIONS[s]).toBeDefined();
      expect(SCOPE_DESCRIPTIONS[s].length).toBeGreaterThan(0);
    }
  });

  describe("hasScope", () => {
    it("returns true when scope is present (string)", () => {
      expect(hasScope("openid read:events", "read:events")).toBe(true);
    });

    it("returns false when scope is missing (string)", () => {
      expect(hasScope("openid read:events", "write:events")).toBe(false);
    });

    it("works with array input", () => {
      expect(hasScope(["openid", "read:events"], "read:events")).toBe(true);
      expect(hasScope(["openid"], "read:events")).toBe(false);
    });
  });

  describe("hasAllScopes", () => {
    it("returns true when all scopes are present", () => {
      expect(hasAllScopes("openid read:events write:events", ["read:events", "write:events"])).toBe(true);
    });

    it("returns false when any scope is missing", () => {
      expect(hasAllScopes("openid read:events", ["read:events", "write:events"])).toBe(false);
    });

    it("returns true for empty required list", () => {
      expect(hasAllScopes("openid", [])).toBe(true);
    });
  });
});

describe("API_SCOPES backward compatibility", () => {
  it("re-exports API_SCOPES from apiKey.server.ts", async () => {
    const { API_SCOPES } = await import("~/lib/apiKey.server");
    expect(API_SCOPES).toContain("read:events");
    expect(API_SCOPES).toContain("write:events");
    expect(API_SCOPES).toContain("manage:players");
    expect(API_SCOPES).toContain("create:events");
  });
});
