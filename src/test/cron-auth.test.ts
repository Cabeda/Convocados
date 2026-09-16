import { describe, it, expect } from "vitest";
import { verifyBearerSecret, requireCronSecret } from "~/lib/cronAuth.server";

const SECRET = "s3cret-cron-token";

function req(authorization?: string) {
  return new Request("https://convocados.cabeda.dev/api/cron/reminders", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("verifyBearerSecret", () => {
  it("accepts the exact bearer token", () => {
    expect(verifyBearerSecret(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(verifyBearerSecret("Bearer nope", SECRET)).toBe(false);
  });

  it("rejects a token that is a prefix of the secret", () => {
    expect(verifyBearerSecret("Bearer s3cret", SECRET)).toBe(false);
  });

  it("rejects the secret without the Bearer prefix", () => {
    expect(verifyBearerSecret(SECRET, SECRET)).toBe(false);
  });

  it("rejects a missing authorization header", () => {
    expect(verifyBearerSecret(null, SECRET)).toBe(false);
  });

  // Fail-closed: an unset secret must never authenticate anyone.
  it("rejects when the configured secret is undefined", () => {
    expect(verifyBearerSecret(`Bearer ${SECRET}`, undefined)).toBe(false);
  });

  it("rejects when the configured secret is empty", () => {
    expect(verifyBearerSecret("Bearer ", "")).toBe(false);
  });

  it("rejects when both are undefined/null", () => {
    expect(verifyBearerSecret(null, undefined)).toBe(false);
  });
});

describe("requireCronSecret", () => {
  it("returns null when the caller is authorised", () => {
    expect(requireCronSecret(req(`Bearer ${SECRET}`), SECRET)).toBeNull();
  });

  it("returns 401 when the caller is not authorised", () => {
    const response = requireCronSecret(req("Bearer wrong"), SECRET);
    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(401);
  });

  it("returns 401 when the secret is unset (fail-closed)", () => {
    const response = requireCronSecret(req(`Bearer ${SECRET}`), undefined);
    expect(response?.status).toBe(401);
  });

  it("returns 401 when no header is present", () => {
    expect(requireCronSecret(req(), SECRET)?.status).toBe(401);
  });
});
