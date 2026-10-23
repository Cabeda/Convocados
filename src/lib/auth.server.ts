
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink } from "better-auth/plugins/magic-link";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { prisma } from "./db.server";
import { sendVerificationEmail, sendChangeEmailVerification, sendMagicLinkEmail } from "./email.server";
import { OAUTH_SCOPES } from "./scopes";
import { hashTrustedClientSecret } from "./trustedClient.server";
import { repairStaleJwks } from "./jwksRepair.server";

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
      redirectUris: JSON.stringify(redirectUrls),
      skipConsent: true,
    },
    update: {
      clientSecret: hashedSecret,
      redirectUris: JSON.stringify(redirectUrls),
      skipConsent: true,
    },
  });
}

export const auth = betterAuth({
  baseURL: baseUrl,
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Auto-enable email for Google users — their email is verified by Google
          // and stored in User.email, so we can send them invite emails directly.
          try {
            const googleAccount = await prisma.account.findFirst({
              where: { userId: user.id, providerId: "google" },
              select: { id: true },
            });
            if (googleAccount && (user as any).emailVerified) {
              await prisma.notificationPreferences.upsert({
                where: { userId: user.id },
                create: {
                  userId: user.id,
                  emailEnabled: true,
                  gameInviteEmail: true,
                },
                update: {
                  emailEnabled: true,
                  gameInviteEmail: true,
                },
              });
            }
          } catch {
            // ignore — prefs will be created lazily with defaults on first fetch
          }
        },
      },
    },
    // better-auth 1.7.3 no longer writes `Account.issuer` (upstream treats it
    // as an optional, plugin-owned column; the prisma adapter drops it from
    // create payloads). We re-stamp it right after insert for the well-known
    // identity providers so rows keep the same issuer scoping the unique
    // (issuer, accountId) key has had since the 1.7.1 upgrade.
    account: {
      create: {
        after: async (account) => {
          if ((account as { issuer?: string | null }).issuer) return;
          const issuer =
            account.providerId === "google"
              ? "https://accounts.google.com"
              : account.providerId === "credential"
                ? "local:credential"
                : null;
          if (issuer) {
            await prisma.account.update({
              where: { id: account.id },
              data: { issuer },
            });
          }
        },
      },
    },
  },
  // Per-IP auth rate limiting (better-auth built-in). Enabled only in
  // production to avoid throttling the test suite. customRules tighten the
  // bot-farm choke points: account creation and magic-link sending.
  rateLimit: {
    enabled: process.env.NODE_ENV === "production",
    window: 60,
    max: 30,
    customRules: {
      "/sign-up/email": { window: 3600, max: 5 },
      "/magic-link/send": { window: 3600, max: 5 },
      "/sign-in/social": { window: 60, max: 10 },
      "/callback/google": { window: 60, max: 20 },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  // ADR 0040: multi-credential linking. Google may attach to a User whose
  // Primary email is non-Google (e.g. Proton); match/merge is by Account
  // (issuer, accountId), never by email string. Same-email sign-in still
  // auto-links via better-auth's implicit linking (Q13).
  account: {
    accountLinking: {
      allowDifferentEmails: true,
      trustedProviders: ["google"],
      // Unlink last credential is blocked by our /api/me/credentials DELETE
      // and better-auth's default (allowUnlinkingAll unset → false).
      allowUnlinkingAll: false,
    },
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
    // One issuer everywhere (#1501). The oauth-provider plugin derives the
    // issuer from this plugin's option, else from its own baseURL, which ends
    // in `/api/auth`. That path-suffixed issuer disagreed with the metadata we
    // publish at `/.well-known/oauth-authorization-server` (no path), and
    // Claude.ai refused the connector on the mismatch.
    jwt({ jwt: { issuer: baseUrl } }),
    oauthProvider({
      loginPage: "/auth/signin",
      consentPage: "/oauth/consent",
      allowDynamicClientRegistration: true,
      // MCP connector backends (Claude.ai, ChatGPT) register server-side, with
      // no session and no token — requiring one killed the whole OAuth flow
      // ("Authentication failed") before the user reached the login page.
      allowUnauthenticatedClientRegistration: true,
      accessTokenExpiresIn: 3600, // 1 hour
      refreshTokenExpiresIn: 15552000, // 180 days
      codeExpiresIn: 600, // 10 minutes
      scopes: OAUTH_SCOPES,
      clientRegistrationDefaultScopes: ["openid"],
      // A registered client may only request scopes from this set, and the
      // client's registered scopes bound what it can ask for at /authorize.
      // Left unset, registration accepted `openid` only — so an MCP client
      // asking for `read:events`/`create:events` was rejected with
      // invalid_scope, and one that registered with the default could never
      // authorize anything else.
      clientRegistrationAllowedScopes: OAUTH_SCOPES,
      // RFC 8707: Claude sends `resource=<MCP URL>` on /authorize. The provider
      // only accepts a resource that has its own row, and rejects the request
      // with `invalid_target` before consent otherwise — so registration
      // succeeded, no consent or token was ever created, and the connector
      // reported a bare auth failure.
      resources: [`${baseUrl}/api/mcp`],
      // New clients are linked to every resource they may request; with the
      // per-client check on by default, an unlinked client is refused.
      clientRegistrationDefaultResources: [`${baseUrl}/api/mcp`],
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

/**
 * Remove JWKS signing keys that were encrypted with a previous (now-rotated)
 * auth secret. Without this, rotating BETTER_AUTH_SECRET leaves undecryptable
 * keys in the `jwks` table and every session lookup throws
 * "Failed to decrypt private key" — the app looks like sign-in is broken.
 *
 * Runs lazily once per server process; subsequent calls share the same promise.
 * Safe to call on every auth request.
 */
let _authKeysHealthy: Promise<void> | null = null;
export function ensureAuthKeysHealthy(): Promise<void> {
  if (!_authKeysHealthy) {
    _authKeysHealthy = (async () => {
      const ctx = await auth.$context;
      const removed = await repairStaleJwks(ctx.secretConfig);
      if (removed > 0) {
        console.warn(
          `[auth] removed ${removed} JWKS key(s) that could not be decrypted with the current secret — a new signing key will be minted`,
        );
      }
    })().catch((err) => {
      console.error("[auth] JWKS self-heal failed (non-fatal)", err);
      // Allow a later request to retry.
      _authKeysHealthy = null;
    });
  }
  return _authKeysHealthy;
}

// Kick the self-heal off as soon as the module loads so page SSR (which reads
// sessions through auth.api.getSession) recovers without waiting for a request.
void ensureAuthKeysHealthy();
