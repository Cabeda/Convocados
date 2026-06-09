
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink } from "better-auth/plugins/magic-link";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { prisma } from "./db.server";
import { sendVerificationEmail, sendChangeEmailVerification, sendMagicLinkEmail } from "./email.server";
import { OAUTH_SCOPES } from "./scopes";
import { hashTrustedClientSecret } from "./trustedClient.server";

const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:4321";

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

  await prisma.oauthClient.upsert({
    where: { clientId },
    create: {
      id: clientId,
      clientId,
      clientSecret: hashedSecret,
      name: "Trusted App",
      type: "web",
      redirectUris: redirectUrls.join(","),
      skipConsent: true,
    },
    update: {
      clientSecret: hashedSecret,
      redirectUris: redirectUrls.join(","),
      skipConsent: true,
    },
  });
}

export const auth = betterAuth({
  baseURL: baseUrl,
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  socialProviders: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {},
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail(email, url);
      },
    }),
    jwt(),
    oauthProvider({
      loginPage: "/auth/signin",
      consentPage: "/oauth/consent",
      allowDynamicClientRegistration: true,
      accessTokenExpiresIn: 3600, // 1 hour
      refreshTokenExpiresIn: 15552000, // 180 days
      codeExpiresIn: 600, // 10 minutes
      scopes: OAUTH_SCOPES,
      clientRegistrationDefaultScopes: ["openid"],
      storeClientSecret: "hashed",
      cachedTrustedClients: new Set(
        process.env.TRUSTED_OAUTH_CLIENT_ID ? [process.env.TRUSTED_OAUTH_CLIENT_ID] : [],
      ),
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
    // Keep old fly.dev domain as trusted for backwards compatibility
    "https://convocados.fly.dev",
    // Allow local network access for mobile app development
    ...(process.env.TRUSTED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ],
});
