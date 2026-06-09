/**
 * RFC 7009 — OAuth 2.0 Token Revocation
 * POST /api/auth/oauth2/revoke
 *
 * Revokes an access or refresh token. Always returns 200 per spec.
 */
import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";

export const POST: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "oauth_token");
  if (limited) return limited;

  let body: Record<string, string>;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    body = Object.fromEntries(new URLSearchParams(text));
  } else {
    try {
      body = await request.json();
    } catch {
      // Per RFC 7009, always return 200
      return Response.json({ ok: true }, { status: 200 });
    }
  }

  const token = body.token;
  if (!token) {
    return Response.json({ ok: true }, { status: 200 });
  }

  // Find and delete the token record
  const accessToken = await prisma.oauthAccessToken.findFirst({
    where: { token },
  });

  if (accessToken) {
    await prisma.oauthAccessToken.delete({ where: { id: accessToken.id } });
    return Response.json({ ok: true }, { status: 200 });
  }

  // Check refresh tokens — deleting a refresh token cascades to its access tokens
  const refreshToken = await prisma.oauthRefreshToken.findFirst({
    where: { token },
  });

  if (refreshToken) {
    await prisma.oauthRefreshToken.delete({ where: { id: refreshToken.id } });
  }

  // Per RFC 7009: always return 200, even if token was not found
  return Response.json({ ok: true }, { status: 200 });
};
