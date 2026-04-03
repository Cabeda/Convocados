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

  // Look up the token
  const oauthToken = await prisma.oauthAccessToken.findFirst({
    where: {
      OR: [{ accessToken: token }, { refreshToken: token }],
    },
  });

  if (!oauthToken) {
    return Response.json({ active: false }, { status: 200 });
  }

  const isAccessToken = oauthToken.accessToken === token;
  const expiresAt = isAccessToken
    ? oauthToken.accessTokenExpiresAt
    : oauthToken.refreshTokenExpiresAt;
  const active = expiresAt > new Date();

  return Response.json({
    active,
    scope: oauthToken.scopes,
    client_id: oauthToken.clientId,
    sub: oauthToken.userId ?? undefined,
    token_type: isAccessToken ? "access_token" : "refresh_token",
    exp: Math.floor(expiresAt.getTime() / 1000),
    iat: Math.floor(oauthToken.createdAt.getTime() / 1000),
  });
};
