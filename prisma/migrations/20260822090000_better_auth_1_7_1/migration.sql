/* better-auth 1.6 → 1.7 schema changes (see better-auth 1.7 upgrade guide).
   Account identity is now scoped by a trusted issuer: backfill issuer per
   provider, rebuild the table to enforce NOT NULL (SQLite cannot ALTER
   COLUMN), then add the compound unique index over (issuer, accountId). */

-- 1) Backfill issuer (nullable first)
ALTER TABLE "Account" ADD COLUMN "issuer" TEXT;

UPDATE "Account" SET "issuer" = 'local:credential' WHERE "providerId" = 'credential';
UPDATE "Account" SET "issuer" = 'https://accounts.google.com' WHERE "providerId" = 'google';
-- OAuth providers without an issuer: synthetic local:<encoded providerId>
UPDATE "Account"
SET "issuer" = 'local:oauth:' || REPLACE(REPLACE(REPLACE("providerId", '%', '%25'), '/', '%2F'), ':', '%3A')
WHERE "issuer" IS NULL;

-- 2) Rebuild table with NOT NULL issuer, then create the compound unique index.
--    The unique index also acts as the collision guard from the upgrade guide.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE "new_Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "refreshTokenExpiresAt" DATETIME,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "issuer" TEXT NOT NULL,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Account" ("id", "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt", "issuer")
SELECT "id", "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt", "issuer" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";

-- CreateTable
CREATE UNIQUE INDEX "Account_issuer_accountId_key" ON "Account"("issuer", "accountId");

-- 3) jwks gains signing-key metadata
ALTER TABLE "jwks" ADD COLUMN "alg" TEXT;
ALTER TABLE "jwks" ADD COLUMN "crv" TEXT;

-- 4) oauthClient gains discovery / backchannel-logout / DPoP columns
ALTER TABLE "oauthClient" ADD COLUMN "clientDiscoveryId" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN "clientCredentialsScopes" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN "backchannelLogoutUri" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN "backchannelLogoutSessionRequired" BOOLEAN;
ALTER TABLE "oauthClient" ADD COLUMN "applicationType" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN "jwks" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN "jwksUri" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN "dpopBoundAccessTokens" BOOLEAN;

-- 5) oauthRefreshToken gains rotation-replay + authorization-code linkage
ALTER TABLE "oauthRefreshToken" ADD COLUMN "authorizationCodeId" TEXT;
ALTER TABLE "oauthRefreshToken" ADD COLUMN "resources" TEXT;
ALTER TABLE "oauthRefreshToken" ADD COLUMN "requestedUserInfoClaims" TEXT;
ALTER TABLE "oauthRefreshToken" ADD COLUMN "rotatedAt" DATETIME;
ALTER TABLE "oauthRefreshToken" ADD COLUMN "rotationReplayResponse" TEXT;
ALTER TABLE "oauthRefreshToken" ADD COLUMN "rotationReplayExpiresAt" DATETIME;
ALTER TABLE "oauthRefreshToken" ADD COLUMN "confirmation" TEXT;

-- CreateIndex
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauthRefreshToken"("authorizationCodeId");

-- 6) oauthAccessToken gains resources / claims / revocation / code linkage
ALTER TABLE "oauthAccessToken" ADD COLUMN "authorizationCodeId" TEXT;
ALTER TABLE "oauthAccessToken" ADD COLUMN "resources" TEXT;
ALTER TABLE "oauthAccessToken" ADD COLUMN "requestedUserInfoClaims" TEXT;
ALTER TABLE "oauthAccessToken" ADD COLUMN "revoked" DATETIME;
ALTER TABLE "oauthAccessToken" ADD COLUMN "confirmation" TEXT;

-- CreateIndex
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "oauthAccessToken"("authorizationCodeId");

-- 7) oauthConsent gains resource + claims tracking
ALTER TABLE "oauthConsent" ADD COLUMN "resources" TEXT;
ALTER TABLE "oauthConsent" ADD COLUMN "requestedUserInfoClaims" TEXT;

-- 8) New tables: protected resources (RFC 8707), client-resource links,
--    client-assertion replay cache
-- CreateTable
CREATE TABLE "oauthResource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessTokenTtl" INTEGER,
    "refreshTokenTtl" INTEGER,
    "signingAlgorithm" TEXT,
    "signingKeyId" TEXT,
    "allowedScopes" TEXT,
    "customClaims" TEXT,
    "dpopBoundAccessTokensRequired" BOOLEAN,
    "disabled" BOOLEAN,
    "createdAt" DATETIME,
    "updatedAt" DATETIME,
    "policyVersion" INTEGER,
    "metadata" TEXT
);

-- CreateTable
CREATE TABLE "oauthClientResource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME,
    CONSTRAINT "oauthClientResource_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient" ("clientId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "oauthClientResource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "oauthResource" ("identifier") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauthClientAssertion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "oauthResource_identifier_key" ON "oauthResource"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_key" ON "oauthClientResource"("clientId", "resourceId");

-- CreateIndex
CREATE INDEX "oauthClientResource_clientId_idx" ON "oauthClientResource"("clientId");

-- CreateIndex
CREATE INDEX "oauthClientResource_resourceId_idx" ON "oauthClientResource"("resourceId");
