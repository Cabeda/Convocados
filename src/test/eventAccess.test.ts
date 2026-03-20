import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  makeAccessToken,
  parseAccessCookie,
  hasValidAccessToken,
  buildAccessCookie,
  checkAccess,
  type AccessCheckInput,
} from "~/lib/eventAccess";

// ── Password hashing ─────────────────────────────────────────────────────────

describe("hashPassword / verifyPassword", () => {
  it("should verify a correct password", () => {
    const hashed = hashPassword("secret123");
    expect(verifyPassword("secret123", hashed)).toBe(true);
  });

  it("should reject an incorrect password", () => {
    const hashed = hashPassword("secret123");
    expect(verifyPassword("wrong", hashed)).toBe(false);
  });

  it("should produce different hashes for the same password (salted)", () => {
    const h1 = hashPassword("same");
    const h2 = hashPassword("same");
    expect(h1).not.toBe(h2);
    // But both should verify
    expect(verifyPassword("same", h1)).toBe(true);
    expect(verifyPassword("same", h2)).toBe(true);
  });

  it("should reject empty stored hash", () => {
    expect(verifyPassword("test", "")).toBe(false);
  });

  it("should reject malformed stored hash", () => {
    expect(verifyPassword("test", "nocolon")).toBe(false);
  });
});

// ── Access cookie ────────────────────────────────────────────────────────────

describe("parseAccessCookie", () => {
  it("should return empty object for null", () => {
    expect(parseAccessCookie(null)).toEqual({});
  });

  it("should return empty object for missing cookie", () => {
    expect(parseAccessCookie("other=value")).toEqual({});
  });

  it("should parse a valid ev_access cookie", () => {
    const data = { evt1: "abc123" };
    const cookie = `ev_access=${encodeURIComponent(JSON.stringify(data))}`;
    expect(parseAccessCookie(cookie)).toEqual(data);
  });

  it("should handle multiple cookies", () => {
    const data = { evt1: "abc123" };
    const cookie = `session=xyz; ev_access=${encodeURIComponent(JSON.stringify(data))}; other=val`;
    expect(parseAccessCookie(cookie)).toEqual(data);
  });

  it("should return empty object for malformed JSON", () => {
    expect(parseAccessCookie("ev_access=notjson")).toEqual({});
  });
});

describe("makeAccessToken / hasValidAccessToken", () => {
  it("should validate a correct token", () => {
    const eventId = "evt1";
    const hashedPw = hashPassword("pass");
    const token = makeAccessToken(eventId, hashedPw);
    const cookie = `ev_access=${encodeURIComponent(JSON.stringify({ [eventId]: token }))}`;
    expect(hasValidAccessToken(cookie, eventId, hashedPw)).toBe(true);
  });

  it("should reject a wrong token", () => {
    const hashedPw = hashPassword("pass");
    const cookie = `ev_access=${encodeURIComponent(JSON.stringify({ evt1: "badtoken00000000000000000000000000000000000000000000000000000000" }))}`;
    expect(hasValidAccessToken(cookie, "evt1", hashedPw)).toBe(false);
  });

  it("should reject when no cookie present", () => {
    const hashedPw = hashPassword("pass");
    expect(hasValidAccessToken(null, "evt1", hashedPw)).toBe(false);
  });
});

describe("buildAccessCookie", () => {
  it("should build a valid Set-Cookie string", () => {
    const hashedPw = hashPassword("pass");
    const cookie = buildAccessCookie(null, "evt1", hashedPw);
    expect(cookie).toContain("ev_access=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=");
  });

  it("should merge with existing cookies", () => {
    const hp1 = hashPassword("p1");
    const hp2 = hashPassword("p2");
    const first = buildAccessCookie(null, "evt1", hp1);
    // Extract the cookie value to simulate browser sending it back
    const cookieValue = first.split(";")[0]; // ev_access=...
    const second = buildAccessCookie(cookieValue, "evt2", hp2);
    // Parse the result — should have both events
    const parsed = parseAccessCookie(second.split(";")[0]);
    expect(parsed).toHaveProperty("evt1");
    expect(parsed).toHaveProperty("evt2");
  });
});

// ── checkAccess ──────────────────────────────────────────────────────────────

describe("checkAccess", () => {
  const base: AccessCheckInput = {
    eventOwnerId: "owner1",
    accessPassword: null,
    requestUserId: null,
    cookieHeader: null,
    eventId: "evt1",
    isInvited: false,
  };

  it("should grant access when no password is set", () => {
    expect(checkAccess(base)).toEqual({ granted: true });
  });

  it("should require password when set and no credentials", () => {
    const result = checkAccess({ ...base, accessPassword: "salt:hash" });
    expect(result).toEqual({ granted: false, reason: "password_required" });
  });

  it("should grant access to the owner even with password", () => {
    const result = checkAccess({
      ...base,
      accessPassword: "salt:hash",
      requestUserId: "owner1",
    });
    expect(result).toEqual({ granted: true });
  });

  it("should grant access to invited users even with password", () => {
    const result = checkAccess({
      ...base,
      accessPassword: "salt:hash",
      isInvited: true,
    });
    expect(result).toEqual({ granted: true });
  });

  it("should grant access with valid cookie token", () => {
    const hashedPw = hashPassword("secret");
    const token = makeAccessToken("evt1", hashedPw);
    const cookie = `ev_access=${encodeURIComponent(JSON.stringify({ evt1: token }))}`;
    const result = checkAccess({
      ...base,
      accessPassword: hashedPw,
      cookieHeader: cookie,
    });
    expect(result).toEqual({ granted: true });
  });

  it("should deny access with invalid cookie token", () => {
    const hashedPw = hashPassword("secret");
    const cookie = `ev_access=${encodeURIComponent(JSON.stringify({ evt1: "0".repeat(64) }))}`;
    const result = checkAccess({
      ...base,
      accessPassword: hashedPw,
      cookieHeader: cookie,
    });
    expect(result).toEqual({ granted: false, reason: "password_required" });
  });

  it("should not grant owner access when owner ID is null (ownerless)", () => {
    const result = checkAccess({
      ...base,
      eventOwnerId: null,
      accessPassword: "salt:hash",
      requestUserId: "someuser",
    });
    expect(result).toEqual({ granted: false, reason: "password_required" });
  });
});
