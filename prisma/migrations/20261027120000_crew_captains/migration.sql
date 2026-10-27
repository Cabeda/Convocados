-- A Crew has one captain: a SeasonMembership of that same crew (#1442). Nullable,
-- and unique so one membership cannot captain two crews. The same-crew rule is
-- application code: SQLite cannot express "the referenced membership is in this crew".
-- CrewProposal learns kind (create|add|remove), a target crew for add/remove, and an
-- author user id for a captain nomination the owner makes without playing (null
-- proposerMembershipId). CrewProposalMember learns add|remove; existing rows add.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Crew" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "captainMembershipId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Crew_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Crew_captainMembershipId_fkey" FOREIGN KEY ("captainMembershipId") REFERENCES "SeasonMembership" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Crew" ("createdAt", "id", "name", "seasonId", "sortOrder", "updatedAt") SELECT "createdAt", "id", "name", "seasonId", "sortOrder", "updatedAt" FROM "Crew";
DROP TABLE "Crew";
ALTER TABLE "new_Crew" RENAME TO "Crew";
CREATE UNIQUE INDEX "Crew_captainMembershipId_key" ON "Crew"("captainMembershipId");
CREATE INDEX "Crew_seasonId_idx" ON "Crew"("seasonId");
CREATE UNIQUE INDEX "Crew_seasonId_name_key" ON "Crew"("seasonId", "name");
CREATE UNIQUE INDEX "Crew_seasonId_sortOrder_key" ON "Crew"("seasonId", "sortOrder");
CREATE TABLE "new_CrewProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonId" TEXT NOT NULL,
    "proposerMembershipId" TEXT,
    "proposedByUserId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'create',
    "targetCrewId" TEXT,
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
    CONSTRAINT "CrewProposal_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CrewProposal_targetCrewId_fkey" FOREIGN KEY ("targetCrewId") REFERENCES "Crew" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CrewProposal_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CrewProposal_approvedCrewId_fkey" FOREIGN KEY ("approvedCrewId") REFERENCES "Crew" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CrewProposal" ("approvedCrewId", "createdAt", "id", "name", "proposerMembershipId", "rejectionReason", "reviewedAt", "reviewedByUserId", "seasonId", "status", "updatedAt") SELECT "approvedCrewId", "createdAt", "id", "name", "proposerMembershipId", "rejectionReason", "reviewedAt", "reviewedByUserId", "seasonId", "status", "updatedAt" FROM "CrewProposal";
DROP TABLE "CrewProposal";
ALTER TABLE "new_CrewProposal" RENAME TO "CrewProposal";
CREATE UNIQUE INDEX "CrewProposal_approvedCrewId_key" ON "CrewProposal"("approvedCrewId");
CREATE INDEX "CrewProposal_seasonId_status_idx" ON "CrewProposal"("seasonId", "status");
CREATE INDEX "CrewProposal_proposerMembershipId_idx" ON "CrewProposal"("proposerMembershipId");
CREATE INDEX "CrewProposal_targetCrewId_idx" ON "CrewProposal"("targetCrewId");
CREATE TABLE "new_CrewProposalMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "seasonMembershipId" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'add',
    CONSTRAINT "CrewProposalMember_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CrewProposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CrewProposalMember_seasonMembershipId_fkey" FOREIGN KEY ("seasonMembershipId") REFERENCES "SeasonMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CrewProposalMember" ("id", "proposalId", "seasonMembershipId") SELECT "id", "proposalId", "seasonMembershipId" FROM "CrewProposalMember";
DROP TABLE "CrewProposalMember";
ALTER TABLE "new_CrewProposalMember" RENAME TO "CrewProposalMember";
CREATE INDEX "CrewProposalMember_seasonMembershipId_idx" ON "CrewProposalMember"("seasonMembershipId");
CREATE UNIQUE INDEX "CrewProposalMember_proposalId_seasonMembershipId_key" ON "CrewProposalMember"("proposalId", "seasonMembershipId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

