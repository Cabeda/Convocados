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

  // Find and delete the token record (revokes both access + refresh)
  const oauthToken = await prisma.oauthAccessToken.findFirst({
    where: {
      OR: [{ accessToken: token }, { refreshToken: token }],
    },
  });

  if (oauthToken) {
    await prisma.oauthAccessToken.delete({ where: { id: oauthToken.id } });
  }

  // Per RFC 7009: always return 200, even if token was not found
  return Response.json({ ok: true }, { status: 200 });
};
