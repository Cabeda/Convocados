import type { APIRoute } from "astro";
import { auth } from "../../../lib/auth.server";
import { prisma } from "../../../lib/db.server";
import crypto from "node:crypto";

const MOBILE_CLIENT_ID = "convocados-mobile-app";

/** Ensure the mobile OAuth application exists in the DB */
let _mobileClientInitialized = false;
async function ensureMobileClient() {
  if (_mobileClientInitialized) return;
  _mobileClientInitialized = true;

  await prisma.oauthApplication.upsert({
    where: { clientId: MOBILE_CLIENT_ID },
    create: {
      clientId: MOBILE_CLIENT_ID,
      clientSecret: "",
      name: "Convocados Mobile App",
      type: "native",
      redirectUrls: "convocados://auth",
      updatedAt: new Date(),
    },
    update: {},
  });
}

/**
 * GET /api/auth/mobile-callback
 *
 * After a user signs in in the browser, this endpoint generates a one-time
 * code and redirects to the app's deep link scheme so the mobile app can
 * exchange it for tokens.
 *
 * Query params:
 *   redirect_uri — the app's deep link (default: convocados://auth)
 */
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const redirectUri = url.searchParams.get("redirect_uri") ?? "convocados://auth";

  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      // Not logged in — redirect to sign-in page with return URL
      const returnUrl = `/api/auth/mobile-callback?redirect_uri=${encodeURIComponent(redirectUri)}`;
      return Response.redirect(
        new URL(`/auth/signin?callbackURL=${encodeURIComponent(returnUrl)}`, url.origin).toString(),
        302,
      );
    }

    await ensureMobileClient();

    // Generate a one-time code
    const code = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 5 * 60_000); // 5 minutes

    // Store as a temporary token entry
    await prisma.oauthAccessToken.create({
      data: {
        accessToken: `mcode_${code}`,
        refreshToken: `mcode_ref_${code}`,
        accessTokenExpiresAt: expiresAt,
        refreshTokenExpiresAt: expiresAt,
        userId: session.user.id,
        clientId: MOBILE_CLIENT_ID,
        scopes: "_onetime_code",
      },
    });

    // Redirect to the app with the code
    // NOTE: Don't use `new URL(redirectUri)` because the URL constructor
    // normalizes "convocados://auth" to "convocados:///auth" (triple slash),
    // which breaks Android deep link matching.
    const separator = redirectUri.includes("?") ? "&" : "?";
    const appUrl = `${redirectUri}${separator}code=${encodeURIComponent(code)}`;
    return Response.redirect(appUrl, 302);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[mobile-callback error]", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
};

/**
 * POST /api/auth/mobile-callback
 *
 * Exchange a one-time code for real OAuth tokens.
 * Called by the mobile app after receiving the code via deep link.
 */
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json();
  const code = String(body.code ?? "").trim();

  if (!code) {
    return Response.json({ error: "Code is required" }, { status: 400 });
  }

  await ensureMobileClient();

  // Find and validate the one-time code
  const record = await prisma.oauthAccessToken.findFirst({
    where: {
      accessToken: `mcode_${code}`,
      clientId: MOBILE_CLIENT_ID,
      scopes: "_onetime_code",
    },
  });

  if (!record || record.accessTokenExpiresAt < new Date()) {
    if (record) {
      await prisma.oauthAccessToken.delete({ where: { id: record.id } }).catch(() => {});
    }
    return Response.json({ error: "Invalid or expired code" }, { status: 400 });
  }

  // Delete the one-time code
  await prisma.oauthAccessToken.delete({ where: { id: record.id } });

  // Create real tokens for the mobile app
  const accessToken = crypto.randomBytes(32).toString("hex");
  const refreshToken = crypto.randomBytes(32).toString("hex");
  const expiresIn = 3600; // 1 hour

  await prisma.oauthAccessToken.create({
    data: {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 86400_000), // 30 days
      userId: record.userId,
      clientId: MOBILE_CLIENT_ID,
      scopes: "openid profile email offline_access read:events write:events manage:players read:ratings read:history manage:teams manage:push",
    },
  });

  return Response.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: expiresIn,
  });
};
