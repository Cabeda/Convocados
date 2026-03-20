/**
 * Event access control — password hashing, verification, and access checks.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";

// ── Password hashing (SHA-256 + salt — lightweight, no bcrypt dep needed) ────

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + plain).digest("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = createHash("sha256").update(salt + plain).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
  } catch {
    return false;
  }
}

// ── Access token (cookie-based session for password-unlocked events) ─────────

const ACCESS_COOKIE = "ev_access";

/** Build a per-event access token from the hashed password. */
export function makeAccessToken(eventId: string, hashedPassword: string): string {
  return createHash("sha256").update(`${eventId}:${hashedPassword}`).digest("hex");
}

/** Parse the ev_access cookie map: { eventId: token, ... } */
export function parseAccessCookie(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const match = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${ACCESS_COOKIE}=`));
  if (!match) return {};
  try {
    return JSON.parse(decodeURIComponent(match.split("=").slice(1).join("=")));
  } catch {
    return {};
  }
}

/** Check if a request has a valid access token for the given event. */
export function hasValidAccessToken(
  cookieHeader: string | null,
  eventId: string,
  hashedPassword: string,
): boolean {
  const tokens = parseAccessCookie(cookieHeader);
  const token = tokens[eventId];
  if (!token) return false;
  const expected = makeAccessToken(eventId, hashedPassword);
  try {
    return timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/** Build a Set-Cookie header value that grants access to an event. */
export function buildAccessCookie(
  cookieHeader: string | null,
  eventId: string,
  hashedPassword: string,
): string {
  const existing = parseAccessCookie(cookieHeader);
  existing[eventId] = makeAccessToken(eventId, hashedPassword);
  const value = encodeURIComponent(JSON.stringify(existing));
  // 30-day expiry, HttpOnly, SameSite=Lax
  return `${ACCESS_COOKIE}=${value}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax`;
}

// ── Access decision ──────────────────────────────────────────────────────────

export interface AccessCheckInput {
  eventOwnerId: string | null;
  accessPassword: string | null;
  requestUserId: string | null;
  cookieHeader: string | null;
  eventId: string;
  isInvited: boolean;
}

export type AccessResult =
  | { granted: true }
  | { granted: false; reason: "password_required" };

/**
 * Determine if a request has access to an event.
 *
 * Access is granted if ANY of:
 * 1. Event has no password (open access)
 * 2. Requester is the event owner
 * 3. Requester is on the invite list
 * 4. Requester has a valid access cookie token
 */
export function checkAccess(input: AccessCheckInput): AccessResult {
  // No password → open access
  if (!input.accessPassword) return { granted: true };

  // Owner always has access
  if (input.requestUserId && input.eventOwnerId && input.requestUserId === input.eventOwnerId) {
    return { granted: true };
  }

  // Invited users bypass password
  if (input.isInvited) return { granted: true };

  // Check cookie token
  if (hasValidAccessToken(input.cookieHeader, input.eventId, input.accessPassword)) {
    return { granted: true };
  }

  return { granted: false, reason: "password_required" };
}
