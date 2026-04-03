import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink } from "better-auth/plugins/magic-link";
import { oidcProvider } from "better-auth/plugins/oidc-provider";
import { prisma } from "./db.server";
import { sendVerificationEmail, sendChangeEmailVerification, sendMagicLinkEmail } from "./email.server";
import { OAUTH_SCOPES } from "./scopes";
import { hashTrustedClientSecret } from "./trustedClient.server";

const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:4321";

/**
 * Build the trustedClients array from environment variables.
 * Trusted clients skip the consent screen, which is required for
 * non-browser OAuth clients (Bruno, Android/WearOS apps) that cannot
 * handle the interactive consent redirect flow.
 *
 * The secret is pre-hashed (SHA-256 → base64url) to match better-auth's
 * `storeClientSecret: "hashed"` verification, which hashes the incoming
 * secret and compares it to the stored value.
 */
function buildTrustedClients() {
  const clientId = process.env.TRUSTED_OAUTH_CLIENT_ID;
  const rawSecret = process.env.TRUSTED_OAUTH_CLIENT_SECRET;
  if (!clientId) return [];

  const hashedSecret = rawSecret ? hashTrustedClientSecret(rawSecret) : "";
  const redirectUrls = (process.env.TRUSTED_OAUTH_REDIRECT_URIS ?? "https://oauth.usebruno.com/callback")
    .split(",")
    .map((u) => u.trim());

  return [
    {
      clientId,
      clientSecret: hashedSecret,
      name: "Trusted App",
      type: "web" as const,
      redirectUrls,
      metadata: null,
      skipConsent: true,
      disabled: false,
    },
  ];
}

// Ensure the trusted client DB row exists on first request (lazy init)
let _trustedClientInitialized = false;
export async function ensureTrustedClientInDB() {
  if (_trustedClientInitialized) return;
  _trustedClientInitialized = true;

  const clientId = process.env.TRUSTED_OAUTH_CLIENT_ID;
  const rawSecret = process.env.TRUSTED_OAUTH_CLIENT_SECRET;
  if (!clientId) return;

  const hashedSecret = rawSecret ? hashTrustedClientSecret(rawSecret) : "";
  const redirectUrls = (process.env.TRUSTED_OAUTH_REDIRECT_URIS ?? "https://oauth.usebruno.com/callback")
    .split(",")
    .map((u) => u.trim());

  await prisma.oauthApplication.upsert({
    where: { clientId },
    create: {
      clientId,
      clientSecret: hashedSecret,
      name: "Trusted App",
      type: "web",
      redirectUrls: redirectUrls.join(","),
      updatedAt: new Date(),
    },
    update: {
      clientSecret: hashedSecret,
      redirectUrls: redirectUrls.join(","),
      updatedAt: new Date(),
    },
  });
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail(email, url);
      },
    }),
    oidcProvider({
      loginPage: "/auth/signin",
      consentPage: "/oauth/consent",
      requirePKCE: true,
      allowPlainCodeChallengeMethod: false,
      allowDynamicClientRegistration: true,
      accessTokenExpiresIn: 3600, // 1 hour
      refreshTokenExpiresIn: 604800, // 7 days
      codeExpiresIn: 600, // 10 minutes
      scopes: OAUTH_SCOPES,
      defaultScope: "openid",
      storeClientSecret: "hashed",
      trustedClients: buildTrustedClients(),
    }),
  ],
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail(user.email, url);
    },
  },
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async ({ newEmail, url }: { newEmail: string; url: string }) => {
        await sendChangeEmailVerification(newEmail, url);
      },
    },
  },
  trustedOrigins: [
    baseUrl,
    // Allow local network access for mobile app development
    ...(process.env.TRUSTED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ],
});
