/*
  Warnings:

  - You are about to drop the `OauthAccessToken` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `OauthApplication` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `OauthConsent` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "OauthAccessToken";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "OauthApplication";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "OauthConsent";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "jwks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "expiresAt" DATETIME
);

-- CreateTable
CREATE TABLE "oauthClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT,
    "disabled" BOOLEAN DEFAULT false,
    "skipConsent" BOOLEAN,
    "enableEndSession" BOOLEAN,
    "subjectType" TEXT,
    "scopes" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME,
    "updatedAt" DATETIME,
    "name" TEXT,
    "uri" TEXT,
    "icon" TEXT,
    "contacts" TEXT,
    "tos" TEXT,
    "policy" TEXT,
    "softwareId" TEXT,
    "softwareVersion" TEXT,
    "softwareStatement" TEXT,
    "redirectUris" TEXT NOT NULL,
    "postLogoutRedirectUris" TEXT,
    "tokenEndpointAuthMethod" TEXT,
    "grantTypes" TEXT,
    "responseTypes" TEXT,
    "public" BOOLEAN,
    "type" TEXT,
    "requirePKCE" BOOLEAN,
    "referenceId" TEXT,
    "metadata" TEXT,
    CONSTRAINT "oauthClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauthRefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT NOT NULL,
    "referenceId" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME,
    "revoked" DATETIME,
    "authTime" DATETIME,
    "scopes" TEXT NOT NULL,
    CONSTRAINT "oauthRefreshToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient" ("clientId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "oauthRefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "oauthRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauthAccessToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "referenceId" TEXT,
    "refreshId" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME,
    "scopes" TEXT,
    CONSTRAINT "oauthAccessToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient" ("clientId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "oauthAccessToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "oauthAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "oauthAccessToken_refreshId_fkey" FOREIGN KEY ("refreshId") REFERENCES "oauthRefreshToken" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauthConsent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "consentGiven" BOOLEAN NOT NULL,
    "referenceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "oauthConsent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient" ("clientId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "oauthConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "oauthClient_clientId_key" ON "oauthClient"("clientId");

-- CreateIndex
CREATE INDEX "oauthClient_userId_idx" ON "oauthClient"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "oauthRefreshToken_token_key" ON "oauthRefreshToken"("token");

-- CreateIndex
CREATE INDEX "oauthRefreshToken_clientId_idx" ON "oauthRefreshToken"("clientId");

-- CreateIndex
CREATE INDEX "oauthRefreshToken_sessionId_idx" ON "oauthRefreshToken"("sessionId");

-- CreateIndex
CREATE INDEX "oauthRefreshToken_userId_idx" ON "oauthRefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "oauthAccessToken_token_key" ON "oauthAccessToken"("token");

-- CreateIndex
CREATE INDEX "oauthAccessToken_clientId_idx" ON "oauthAccessToken"("clientId");

-- CreateIndex
CREATE INDEX "oauthAccessToken_userId_idx" ON "oauthAccessToken"("userId");

-- CreateIndex
CREATE INDEX "oauthAccessToken_sessionId_idx" ON "oauthAccessToken"("sessionId");

-- CreateIndex
CREATE INDEX "oauthAccessToken_refreshId_idx" ON "oauthAccessToken"("refreshId");

-- CreateIndex
CREATE INDEX "oauthConsent_clientId_idx" ON "oauthConsent"("clientId");

-- CreateIndex
CREATE INDEX "oauthConsent_userId_idx" ON "oauthConsent"("userId");
