import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db.server";
import { APP_SCOPES } from "./scopes";

export { APP_SCOPES as API_SCOPES };
export type ApiScope = (typeof APP_SCOPES)[number];

/** Hash an API key for storage (SHA-256) */
export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Generate a new API key with prefix `cvk_` */
export function generateApiKey(): { raw: string; hashed: string } {
  const raw = `cvk_${randomBytes(32).toString("hex")}`;
  return { raw, hashed: hashApiKey(raw) };
}

/** Validate a raw API key. Returns key metadata or null. */
export async function validateApiKey(
  raw: string,
): Promise<{ userId: string; scopes: string[]; keyId: string } | null> {
  const hashed = hashApiKey(raw);
  const key = await prisma.apiKey.findUnique({ where: { hashedKey: hashed } });
  if (!key) return null;

  // Update lastUsedAt
  await prisma.apiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  return {
    userId: key.userId,
    scopes: JSON.parse(key.scopes) as string[],
    keyId: key.id,
  };
}

/**
 * Extract and validate Bearer token from request.
 * Supports both session auth (via better-auth) and API key auth.
 */
export async function authenticateApiKey(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer cvk_")) return null;
  const token = authHeader.slice(7); // Remove "Bearer "
  return validateApiKey(token);
}

/** Check if a key has a required scope */
export function hasScope(scopes: string[], required: ApiScope): boolean {
  return scopes.includes(required);
}
