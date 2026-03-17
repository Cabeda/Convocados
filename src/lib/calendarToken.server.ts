import { randomBytes } from "node:crypto";
import { prisma } from "./db.server";

/**
 * Generate a cryptographically random token for private calendar feeds.
 */
function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Get or create a calendar feed token for a user-scoped feed.
 */
export async function getOrCreateUserFeedToken(userId: string): Promise<string> {
  const existing = await prisma.calendarToken.findFirst({
    where: { userId, scope: "user", scopeId: null },
  });
  if (existing) return existing.token;

  const token = generateToken();
  await prisma.calendarToken.create({
    data: { token, userId, scope: "user" },
  });
  return token;
}

/**
 * Get or create a calendar feed token for an event-scoped feed.
 */
export async function getOrCreateEventFeedToken(
  userId: string,
  eventId: string,
): Promise<string> {
  const existing = await prisma.calendarToken.findFirst({
    where: { userId, scope: "event", scopeId: eventId },
  });
  if (existing) return existing.token;

  const token = generateToken();
  await prisma.calendarToken.create({
    data: { token, userId, scope: "event", scopeId: eventId },
  });
  return token;
}

/**
 * Validate a token and return the associated metadata.
 * Returns null if the token is invalid.
 */
export async function validateFeedToken(token: string) {
  const record = await prisma.calendarToken.findUnique({ where: { token } });
  if (!record) return null;
  return { userId: record.userId, scope: record.scope, scopeId: record.scopeId };
}

/**
 * Revoke all calendar tokens for a user (e.g. for regeneration).
 */
export async function revokeUserTokens(userId: string): Promise<void> {
  await prisma.calendarToken.deleteMany({ where: { userId } });
}
