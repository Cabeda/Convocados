import { timingSafeEqual } from "node:crypto";

/**
 * Shared authentication for scheduler-driven endpoints (`/api/cron/*`,
 * `/api/internal/jobs/*`).
 *
 * These routes are called by the Fly scheduler with a static bearer token, not
 * by a session. The guard is deliberately fail-closed: a missing or empty
 * secret must reject every caller rather than silently disabling the check
 * (the previous `if (SECRET && ...)` shape skipped the guard entirely when the
 * environment variable was unset). The comparison is constant-time so the
 * secret cannot be recovered byte-by-byte.
 */

/** Constant-time check of an `Authorization: Bearer <secret>` header. */
export function verifyBearerSecret(
  authorization: string | null,
  secret: string | undefined | null,
): boolean {
  if (!secret) return false;
  if (!authorization) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(authorization);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Return a 401 response when the caller is not authorised, or null to proceed.
 * Usage: `const denied = requireCronSecret(request, secret); if (denied) return denied;`
 */
export function requireCronSecret(
  request: Request,
  secret: string | undefined | null,
): Response | null {
  if (verifyBearerSecret(request.headers.get("authorization"), secret)) return null;
  return new Response("Unauthorized", { status: 401 });
}
