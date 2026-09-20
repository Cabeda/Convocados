import { symmetricDecrypt, type SecretConfig } from "better-auth/crypto";
import { prisma } from "./db.server";

/**
 * Delete JWKS rows whose encrypted private key can no longer be decrypted with
 * the current secret.
 *
 * better-auth's `jwt()` plugin encrypts the JWKS private key at rest with the
 * auth secret. Rotating `BETTER_AUTH_SECRET` leaves the old ciphertext in the
 * `jwks` table, and every request that signs or reads a token — including
 * `get-session` — then throws:
 *
 *   BetterAuthError: Failed to decrypt private key. Make sure the secret
 *   currently in use is the same as the one used to encrypt the private key.
 *
 * Deleting the undecryptable rows lets better-auth mint a fresh key under the
 * current secret on the next sign. Keys encrypted with a retained secret
 * version (see `BETTER_AUTH_SECRETS`) still decrypt and are kept.
 *
 * Returns the number of stale keys removed.
 */
export async function repairStaleJwks(secretConfig: string | SecretConfig): Promise<number> {
  const rows = await prisma.jwks.findMany({ select: { id: true, privateKey: true } });
  let removed = 0;

  for (const row of rows) {
    let decryptable = true;
    try {
      await symmetricDecrypt({ key: secretConfig, data: JSON.parse(row.privateKey) });
    } catch {
      decryptable = false;
    }
    if (decryptable) continue;

    try {
      await prisma.jwks.delete({ where: { id: row.id } });
      removed++;
    } catch {
      // Row already gone — nothing to do.
    }
  }

  return removed;
}
