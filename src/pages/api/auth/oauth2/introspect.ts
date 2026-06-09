/**
 * RFC 7662 — OAuth 2.0 Token Introspection
 * POST /api/auth/oauth2/introspect
 *
 * Returns metadata about a token (active, scope, exp, sub, client_id, etc.)
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
      return Response.json({ active: false }, { status: 200 });
    }
  }

  const token = body.token;
  if (!token) {
    return Response.json({ active: false }, { status: 200 });
  }

  // Look up the token in access tokens first, then refresh tokens
  const accessToken = await prisma.oauthAccessToken.findFirst({
    where: { token },
  });

  if (accessToken) {
    const active = accessToken.expiresAt ? accessToken.expiresAt > new Date() : true;
    return Response.json({
      active,
      scope: accessToken.scopes,
      client_id: accessToken.clientId,
      sub: accessToken.userId ?? undefined,
      token_type: "access_token",
      exp: accessToken.expiresAt ? Math.floor(accessToken.expiresAt.getTime() / 1000) : undefined,
      iat: accessToken.createdAt ? Math.floor(accessToken.createdAt.getTime() / 1000) : undefined,
    });
  }

  const refreshToken = await prisma.oauthRefreshToken.findFirst({
    where: { token },
  });

  if (refreshToken) {
    const active = refreshToken.expiresAt ? refreshToken.expiresAt > new Date() : true;
    return Response.json({
      active: active && !refreshToken.revoked,
      scope: refreshToken.scopes,
      client_id: refreshToken.clientId,
      sub: refreshToken.userId,
      token_type: "refresh_token",
      exp: refreshToken.expiresAt ? Math.floor(refreshToken.expiresAt.getTime() / 1000) : undefined,
      iat: refreshToken.createdAt ? Math.floor(refreshToken.createdAt.getTime() / 1000) : undefined,
    });
  }

  return Response.json({ active: false }, { status: 200 });
};
