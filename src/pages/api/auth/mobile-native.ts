import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { auth } from "../../../lib/auth.server";
import { rateLimitResponse } from "../../../lib/apiRateLimit.server";
import { verifyGoogleIdToken } from "../../../lib/googleToken.server";
import crypto from "node:crypto";

// ponytail: single endpoint for all native mobile auth flows.
// Dispatches on `action` field: google-id-token, email-signin, email-signup, magic-link.
// Returns OAuth tokens directly (same format as mobile-callback POST).

const MOBILE_CLIENT_ID = "convocados-mobile-app";

/** Issue OAuth tokens for a user. Shared by all auth methods. */
async function issueTokens(userId: string) {
  const accessToken = crypto.randomBytes(32).toString("hex");
  const refreshToken = crypto.randomBytes(32).toString("hex");
  const expiresIn = 3600; // 1 hour

  const refreshRecord = await prisma.oauthRefreshToken.create({
    data: {
      id: crypto.randomUUID(),
      token: refreshToken,
      userId,
      clientId: MOBILE_CLIENT_ID,
      scopes: "openid profile email offline_access read:events write:events manage:players read:ratings read:history manage:teams manage:push",
      expiresAt: new Date(Date.now() + 30 * 86400_000), // 30 days
    },
  });

  await prisma.oauthAccessToken.create({
    data: {
      id: crypto.randomUUID(),
      token: accessToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      userId,
      clientId: MOBILE_CLIENT_ID,
      refreshId: refreshRecord.id,
      scopes: "openid profile email offline_access read:events write:events manage:players read:ratings read:history manage:teams manage:push",
    },
  });

  return Response.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: expiresIn,
  });
}

/** Handle Google ID token sign-in (from Credential Manager). */
async function handleGoogleIdToken(body: Record<string, unknown>, request: Request) {
  const idToken = String(body.idToken ?? "").trim();
  if (!idToken) {
    return Response.json({ error: "idToken is required" }, { status: 400 });
  }

  const validAudiences = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
  ].filter(Boolean) as string[];

  const payload = await verifyGoogleIdToken(idToken, validAudiences);
  if (!payload) {
    return Response.json({ error: "Invalid or expired Google ID token" }, { status: 401 });
  }

  // Find existing user by Google account link or email
  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { accounts: { some: { providerId: "google", accountId: payload.sub } } },
        { email: payload.email },
      ],
    },
  });

  if (!user) {
    // New-account creation is the bot chokepoint — apply the stricter
    // per-IP signup limit before auto-creating the account.
    const limited = await rateLimitResponse(request, "auth_signup");
    if (limited) return limited;

    // Auto-create account for Google sign-in (email is verified by Google)
    user = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        email: payload.email,
        name: payload.name ?? payload.email.split("@")[0],
        image: payload.picture ?? null,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  // Ensure the Google account link exists
  const existingAccount = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "google" },
  });
  if (!existingAccount) {
    await prisma.account.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        accountId: payload.sub,
        providerId: "google",
        issuer: "https://accounts.google.com",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  // Update profile picture if changed
  if (payload.picture && user.image !== payload.picture) {
    await prisma.user.update({ where: { id: user.id }, data: { image: payload.picture } });
  }

  return issueTokens(user.id);
}

/** Handle email/password sign-in. */
async function handleEmailSignIn(body: Record<string, unknown>) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  // Use better-auth's internal sign-in by forwarding a request to it
  const internalReq = new Request("http://localhost/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const res = await auth.handler(internalReq);
  if (!res.ok) {
    const errBody = await res.text();
    // Forward better-auth's error (invalid credentials, unverified email, etc.)
    return new Response(errBody, { status: res.status, headers: { "Content-Type": "application/json" } });
  }

  // better-auth returned success — find the user by email
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  return issueTokens(user.id);
}

/** Handle email/password sign-up. */
async function handleEmailSignUp(body: Record<string, unknown>) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim();

  if (!email || !password) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }
  if (!name) {
    return Response.json({ error: "Name is required" }, { status: 400 });
  }

  // Use better-auth's internal sign-up
  const internalReq = new Request("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });

  const res = await auth.handler(internalReq);
  if (!res.ok) {
    const errBody = await res.text();
    return new Response(errBody, { status: res.status, headers: { "Content-Type": "application/json" } });
  }

  // Account created. Since email verification is required, don't issue tokens yet.
  return Response.json({
    success: true,
    message: "Account created. Please check your email to verify your address before signing in.",
    requires_verification: true,
  }, { status: 201 });
}

/** Handle magic link request. */
async function handleMagicLink(body: Record<string, unknown>) {
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email) {
    return Response.json({ error: "Email is required" }, { status: 400 });
  }

  // Use better-auth's magic link endpoint
  const internalReq = new Request("http://localhost/api/auth/magic-link/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      // The callback URL will go to our mobile-callback flow
      callbackURL: "/api/auth/mobile-callback?redirect_uri=convocados://auth",
    }),
  });

  const res = await auth.handler(internalReq);
  if (!res.ok) {
    return Response.json({ error: "Could not send magic link" }, { status: 400 });
  }

  return Response.json({ success: true, message: "Magic link sent to your email" });
}

/** Refresh tokens for a previously-issued mobile session. */
async function handleRefresh(body: Record<string, unknown>) {
  const refreshToken = String(body.refresh_token ?? "").trim();
  if (!refreshToken) {
    return Response.json({ error: "refresh_token is required" }, { status: 400 });
  }

  const record = await prisma.oauthRefreshToken.findFirst({
    where: { token: refreshToken, clientId: MOBILE_CLIENT_ID },
  });

  if (!record || !record.userId || (record.expiresAt && record.expiresAt <= new Date())) {
    return Response.json(
      { error: "Invalid or expired refresh token" },
      { status: 401 },
    );
  }

  // Rotate: invalidate the used refresh token so it can't be replayed.
  await prisma.oauthRefreshToken.delete({ where: { id: record.id } });

  return issueTokens(record.userId);
}

export const POST: APIRoute = async ({ request }) => {
  // Per-IP rate limit for the whole endpoint before any processing.
  const limited = await rateLimitResponse(request, "auth");
  if (limited) return limited;

  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "").trim();

    switch (action) {
      case "google-id-token":
        return handleGoogleIdToken(body, request);
      case "email-signin":
        return handleEmailSignIn(body);
      case "email-signup":
        return handleEmailSignUp(body);
      case "magic-link":
        return handleMagicLink(body);
      case "refresh":
        return handleRefresh(body);
      default:
        return Response.json(
          { error: "Invalid action. Use: google-id-token, email-signin, email-signup, magic-link, refresh" },
          { status: 400 },
        );
    }
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[mobile-native auth error]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
};
