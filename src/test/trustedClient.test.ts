import { describe, it, expect } from "vitest";
import { hashTrustedClientSecret } from "~/lib/trustedClient.server";
import { createHash } from "node:crypto";

describe("hashTrustedClientSecret", () => {
  it("returns base64url-encoded SHA-256 of the secret", () => {
    const secret = "test-secret-123";
    const expected = createHash("sha256").update(secret).digest("base64url");
    expect(hashTrustedClientSecret(secret)).toBe(expected);
  });

  it("produces different hashes for different secrets", () => {
    expect(hashTrustedClientSecret("a")).not.toBe(hashTrustedClientSecret("b"));
  });
});
