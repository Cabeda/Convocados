import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink } from "better-auth/plugins/magic-link";
import { oidcProvider } from "better-auth/plugins/oidc-provider";
import { prisma } from "./db.server";
import { sendVerificationEmail, sendChangeEmailVerification, sendMagicLinkEmail } from "./email.server";
import { OAUTH_SCOPES } from "./scopes";

const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:4321";

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
      loginPage: "/login",
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
  trustedOrigins: [baseUrl],
});
