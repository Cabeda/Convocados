-- CreateTable
CREATE TABLE "CrewProposalInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "claimedByUserId" TEXT,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claimedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CrewProposalInvite_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CrewProposalInvite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CrewProposalInvite_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CrewProposalInvite_token_key" ON "CrewProposalInvite"("token");
CREATE INDEX "CrewProposalInvite_seasonId_status_idx" ON "CrewProposalInvite"("seasonId", "status");
CREATE INDEX "CrewProposalInvite_email_idx" ON "CrewProposalInvite"("email");
