import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins/magic-link";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import Database from "better-sqlite3";
import { OAUTH_SCOPES } from "../src/lib/scopes";

/**
 * Standalone auth config for `@better-auth/cli generate` only.
 * better-auth 1.7's Kysely adapter requires a driver instance
 * ({ provider, url } is no longer supported), so hand it better-sqlite3.
 * Keep plugin list in sync with src/lib/auth.server.ts.
 */
export const auth = betterAuth({
  database: new Database(process.env.AUTH_CLI_DB_PATH ?? "./dev-cli.db"),
  plugins: [
    magicLink({
      // Schema-generation-only config — no email delivery needed.
      sendMagicLink: async () => {},
    }),
    jwt(),
    oauthProvider({
      loginPage: "/auth/signin",
      consentPage: "/oauth/consent",
      allowDynamicClientRegistration: true,
      accessTokenExpiresIn: 3600,
      refreshTokenExpiresIn: 15552000,
      codeExpiresIn: 600,
      scopes: OAUTH_SCOPES as unknown as string[],
      clientRegistrationDefaultScopes: ["openid"],
      storeClientSecret: "hashed",
    }),
  ],
});
