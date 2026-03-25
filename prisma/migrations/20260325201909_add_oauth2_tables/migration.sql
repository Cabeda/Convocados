-- CreateTable
CREATE TABLE "OauthApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "metadata" TEXT,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT,
    "redirectUrls" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'web',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "authenticationScheme" TEXT NOT NULL DEFAULT 'client_secret_basic',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OauthApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OauthAccessToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" DATETIME NOT NULL,
    "refreshTokenExpiresAt" DATETIME NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "scopes" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OauthAccessToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OauthApplication" ("clientId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OauthAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OauthConsent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "consentGiven" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OauthConsent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OauthApplication" ("clientId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OauthConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OauthApplication_clientId_key" ON "OauthApplication"("clientId");

-- CreateIndex
CREATE INDEX "OauthApplication_userId_idx" ON "OauthApplication"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OauthAccessToken_accessToken_key" ON "OauthAccessToken"("accessToken");

-- CreateIndex
CREATE UNIQUE INDEX "OauthAccessToken_refreshToken_key" ON "OauthAccessToken"("refreshToken");

-- CreateIndex
CREATE INDEX "OauthAccessToken_clientId_idx" ON "OauthAccessToken"("clientId");

-- CreateIndex
CREATE INDEX "OauthAccessToken_userId_idx" ON "OauthAccessToken"("userId");

-- CreateIndex
CREATE INDEX "OauthConsent_clientId_idx" ON "OauthConsent"("clientId");

-- CreateIndex
CREATE INDEX "OauthConsent_userId_idx" ON "OauthConsent"("userId");
