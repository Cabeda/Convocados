/**
 * Repair script for production DB.
 * Applies missing schema changes from migrations that were marked as applied
 * but never actually executed (applied_steps_count = 0).
 *
 * Run via: fly ssh console -a convocados -C "node scripts/repair-prod-db.mjs"
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const statements = [
  // ── 1. Create NotificationJob table ──
  `CREATE TABLE IF NOT EXISTS "NotificationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "senderClientId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "failedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    CONSTRAINT "NotificationJob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "NotificationJob_processedAt_createdAt_idx" ON "NotificationJob"("processedAt", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "NotificationJob_eventId_idx" ON "NotificationJob"("eventId")`,
  `CREATE INDEX IF NOT EXISTS "NotificationJob_failedAt_idx" ON "NotificationJob"("failedAt")`,

  // ── 2. Rebuild PushSubscription with userId column + FK ──
  `PRAGMA defer_foreign_keys=ON`,
  `PRAGMA foreign_keys=OFF`,

  `CREATE TABLE "new_PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "clientId" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `INSERT INTO "new_PushSubscription" ("auth", "clientId", "createdAt", "endpoint", "eventId", "id", "locale", "p256dh")
    SELECT "auth", "clientId", "createdAt", "endpoint", "eventId", "id", "locale", "p256dh" FROM "PushSubscription"`,
  `DROP TABLE "PushSubscription"`,
  `ALTER TABLE "new_PushSubscription" RENAME TO "PushSubscription"`,
  `CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId")`,
  `CREATE UNIQUE INDEX "PushSubscription_eventId_endpoint_key" ON "PushSubscription"("eventId", "endpoint")`,

  // ── 3. Rebuild NotificationPreferences with email-off defaults ──
  `CREATE TABLE "new_NotificationPreferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "gameInviteEmail" BOOLEAN NOT NULL DEFAULT false,
    "gameInvitePush" BOOLEAN NOT NULL DEFAULT true,
    "gameReminderEmail" BOOLEAN NOT NULL DEFAULT false,
    "gameReminderPush" BOOLEAN NOT NULL DEFAULT true,
    "playerActivityPush" BOOLEAN NOT NULL DEFAULT true,
    "eventDetailsPush" BOOLEAN NOT NULL DEFAULT true,
    "weeklySummaryEmail" BOOLEAN NOT NULL DEFAULT false,
    "paymentReminderEmail" BOOLEAN NOT NULL DEFAULT false,
    "paymentReminderPush" BOOLEAN NOT NULL DEFAULT true,
    "reminder24h" BOOLEAN NOT NULL DEFAULT true,
    "reminder2h" BOOLEAN NOT NULL DEFAULT true,
    "reminder1h" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `INSERT INTO "new_NotificationPreferences" ("createdAt", "emailEnabled", "eventDetailsPush", "gameInviteEmail", "gameInvitePush", "gameReminderEmail", "gameReminderPush", "id", "paymentReminderEmail", "paymentReminderPush", "playerActivityPush", "pushEnabled", "reminder1h", "reminder24h", "reminder2h", "updatedAt", "userId", "weeklySummaryEmail")
    SELECT "createdAt", "emailEnabled", "eventDetailsPush", "gameInviteEmail", "gameInvitePush", "gameReminderEmail", "gameReminderPush", "id", "paymentReminderEmail", "paymentReminderPush", "playerActivityPush", "pushEnabled", "reminder1h", "reminder24h", "reminder2h", "updatedAt", "userId", "weeklySummaryEmail" FROM "NotificationPreferences"`,
  `DROP TABLE "NotificationPreferences"`,
  `ALTER TABLE "new_NotificationPreferences" RENAME TO "NotificationPreferences"`,
  `CREATE UNIQUE INDEX "NotificationPreferences_userId_key" ON "NotificationPreferences"("userId")`,

  // ── 4. Create AppPushToken (clean up leftover + create final schema) ──
  `DROP TABLE IF EXISTS "new_AppPushToken"`,
  `DROP TABLE IF EXISTS "AppPushToken"`,
  `CREATE TABLE "AppPushToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppPushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX "AppPushToken_token_key" ON "AppPushToken"("token")`,
  `CREATE INDEX "AppPushToken_userId_idx" ON "AppPushToken"("userId")`,

  // ── 5. Re-enable foreign keys ──
  `PRAGMA foreign_keys=ON`,
  `PRAGMA defer_foreign_keys=OFF`,
];

async function main() {
  console.log("[repair] Starting production DB repair...");

  for (const sql of statements) {
    const label = sql.slice(0, 80).replace(/\s+/g, " ");
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log(`[repair] OK: ${label}...`);
    } catch (err) {
      console.error(`[repair] FAILED: ${label}...`);
      console.error(`  Error: ${err.message}`);
      // Don't stop — some statements may fail if partially applied
    }
  }

  // Verify
  const tables = await prisma.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('NotificationJob','PushSubscription','AppPushToken','NotificationPreferences') ORDER BY name`
  );
  console.log("[repair] Verified tables:", JSON.stringify(tables));

  const pushCols = await prisma.$queryRawUnsafe(
    `SELECT name FROM pragma_table_info('PushSubscription')`
  );
  console.log("[repair] PushSubscription columns:", JSON.stringify(pushCols));

  const jobCols = await prisma.$queryRawUnsafe(
    `SELECT name FROM pragma_table_info('NotificationJob')`
  );
  console.log("[repair] NotificationJob columns:", JSON.stringify(jobCols));

  await prisma.$disconnect();
  console.log("[repair] Done!");
}

main().catch((err) => {
  console.error("[repair] Fatal error:", err);
  process.exit(1);
});
