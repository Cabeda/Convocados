-- CreateTable
CREATE TABLE "CrewProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonId" TEXT NOT NULL,
    "proposerMembershipId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedByUserId" TEXT,
    "reviewedAt" DATETIME,
    "rejectionReason" TEXT,
    "approvedCrewId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CrewProposal_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CrewProposal_proposerMembershipId_fkey" FOREIGN KEY ("proposerMembershipId") REFERENCES "SeasonMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CrewProposal_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CrewProposal_approvedCrewId_fkey" FOREIGN KEY ("approvedCrewId") REFERENCES "Crew" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CrewProposalMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "seasonMembershipId" TEXT NOT NULL,
    CONSTRAINT "CrewProposalMember_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CrewProposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CrewProposalMember_seasonMembershipId_fkey" FOREIGN KEY ("seasonMembershipId") REFERENCES "SeasonMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CrewProposal_seasonId_status_idx" ON "CrewProposal"("seasonId", "status");
CREATE INDEX "CrewProposal_proposerMembershipId_idx" ON "CrewProposal"("proposerMembershipId");
CREATE UNIQUE INDEX "CrewProposal_approvedCrewId_key" ON "CrewProposal"("approvedCrewId");
CREATE UNIQUE INDEX "CrewProposalMember_proposalId_seasonMembershipId_key" ON "CrewProposalMember"("proposalId", "seasonMembershipId");
CREATE INDEX "CrewProposalMember_seasonMembershipId_idx" ON "CrewProposalMember"("seasonMembershipId");
