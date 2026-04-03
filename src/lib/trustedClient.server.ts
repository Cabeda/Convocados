import { createHash } from "node:crypto";

/**
 * Hash a client secret the same way better-auth's defaultClientSecretHasher does:
 * base64url(SHA-256(secret)), no padding.
 *
 * This is needed because better-auth's `storeClientSecret: "hashed"` verification
 * hashes the incoming secret and compares it to the stored value. For trusted clients
 * defined in config (not in the DB), we must pre-hash the secret so the comparison works.
 */
export function hashTrustedClientSecret(secret: string): string {
  const hash = createHash("sha256").update(secret).digest();
  return hash.toString("base64url");
}
