const{PrismaClient}=require("@prisma/client");
const p=new PrismaClient();

async function run(){
  console.log("[repair] Starting...");

  // 1. Create NotificationJob
  await p.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "NotificationJob" ("id" TEXT NOT NULL PRIMARY KEY, "eventId" TEXT NOT NULL, "type" TEXT NOT NULL, "payload" TEXT NOT NULL DEFAULT '{}', "senderClientId" TEXT, "retryCount" INTEGER NOT NULL DEFAULT 0, "failedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "processedAt" DATETIME, CONSTRAINT "NotificationJob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE)`);
  console.log("[repair] Created NotificationJob");

  await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "NotificationJob_processedAt_createdAt_idx" ON "NotificationJob"("processedAt", "createdAt")`);
  await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "NotificationJob_eventId_idx" ON "NotificationJob"("eventId")`);
  await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "NotificationJob_failedAt_idx" ON "NotificationJob"("failedAt")`);
  console.log("[repair] Created NotificationJob indexes");

  // 2. Rebuild PushSubscription with userId
  await p.$executeRawUnsafe(`PRAGMA defer_foreign_keys=ON`);
  await p.$executeRawUnsafe(`PRAGMA foreign_keys=OFF`);

  await p.$executeRawUnsafe(`CREATE TABLE "new_PushSubscription" ("id" TEXT NOT NULL PRIMARY KEY, "eventId" TEXT NOT NULL, "endpoint" TEXT NOT NULL, "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL, "locale" TEXT NOT NULL DEFAULT 'en', "clientId" TEXT NOT NULL DEFAULT '', "userId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PushSubscription_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE)`);
  await p.$executeRawUnsafe(`INSERT INTO "new_PushSubscription" ("auth", "clientId", "createdAt", "endpoint", "eventId", "id", "locale", "p256dh") SELECT "auth", "clientId", "createdAt", "endpoint", "eventId", "id", "locale", "p256dh" FROM "PushSubscription"`);
  await p.$executeRawUnsafe(`DROP TABLE "PushSubscription"`);
  await p.$executeRawUnsafe(`ALTER TABLE "new_PushSubscription" RENAME TO "PushSubscription"`);
  await p.$executeRawUnsafe(`CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId")`);
  await p.$executeRawUnsafe(`CREATE UNIQUE INDEX "PushSubscription_eventId_endpoint_key" ON "PushSubscription"("eventId", "endpoint")`);
  console.log("[repair] Rebuilt PushSubscription with userId");

  // 3. Rebuild NotificationPreferences with email-off defaults
  await p.$executeRawUnsafe(`CREATE TABLE "new_NotificationPreferences" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "emailEnabled" BOOLEAN NOT NULL DEFAULT false, "pushEnabled" BOOLEAN NOT NULL DEFAULT true, "gameInviteEmail" BOOLEAN NOT NULL DEFAULT false, "gameInvitePush" BOOLEAN NOT NULL DEFAULT true, "gameReminderEmail" BOOLEAN NOT NULL DEFAULT false, "gameReminderPush" BOOLEAN NOT NULL DEFAULT true, "playerActivityPush" BOOLEAN NOT NULL DEFAULT true, "eventDetailsPush" BOOLEAN NOT NULL DEFAULT true, "weeklySummaryEmail" BOOLEAN NOT NULL DEFAULT false, "paymentReminderEmail" BOOLEAN NOT NULL DEFAULT false, "paymentReminderPush" BOOLEAN NOT NULL DEFAULT true, "reminder24h" BOOLEAN NOT NULL DEFAULT true, "reminder2h" BOOLEAN NOT NULL DEFAULT true, "reminder1h" BOOLEAN NOT NULL DEFAULT false, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "NotificationPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE)`);
  await p.$executeRawUnsafe(`INSERT INTO "new_NotificationPreferences" ("createdAt", "emailEnabled", "eventDetailsPush", "gameInviteEmail", "gameInvitePush", "gameReminderEmail", "gameReminderPush", "id", "paymentReminderEmail", "paymentReminderPush", "playerActivityPush", "pushEnabled", "reminder1h", "reminder24h", "reminder2h", "updatedAt", "userId", "weeklySummaryEmail") SELECT "createdAt", "emailEnabled", "eventDetailsPush", "gameInviteEmail", "gameInvitePush", "gameReminderEmail", "gameReminderPush", "id", "paymentReminderEmail", "paymentReminderPush", "playerActivityPush", "pushEnabled", "reminder1h", "reminder24h", "reminder2h", "updatedAt", "userId", "weeklySummaryEmail" FROM "NotificationPreferences"`);
  await p.$executeRawUnsafe(`DROP TABLE "NotificationPreferences"`);
  await p.$executeRawUnsafe(`ALTER TABLE "new_NotificationPreferences" RENAME TO "NotificationPreferences"`);
  await p.$executeRawUnsafe(`CREATE UNIQUE INDEX "NotificationPreferences_userId_key" ON "NotificationPreferences"("userId")`);
  console.log("[repair] Rebuilt NotificationPreferences");

  // 4. Create AppPushToken + cleanup
  await p.$executeRawUnsafe(`DROP TABLE IF EXISTS "new_AppPushToken"`);
  await p.$executeRawUnsafe(`DROP TABLE IF EXISTS "AppPushToken"`);
  await p.$executeRawUnsafe(`CREATE TABLE "AppPushToken" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "token" TEXT NOT NULL, "platform" TEXT NOT NULL, "locale" TEXT NOT NULL DEFAULT 'en', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "AppPushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE)`);
  await p.$executeRawUnsafe(`CREATE UNIQUE INDEX "AppPushToken_token_key" ON "AppPushToken"("token")`);
  await p.$executeRawUnsafe(`CREATE INDEX "AppPushToken_userId_idx" ON "AppPushToken"("userId")`);
  console.log("[repair] Created AppPushToken");

  await p.$executeRawUnsafe(`PRAGMA foreign_keys=ON`);
  await p.$executeRawUnsafe(`PRAGMA defer_foreign_keys=OFF`);

  // Verify
  const tables = await p.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('NotificationJob','PushSubscription','AppPushToken','NotificationPreferences') ORDER BY name`);
  console.log("[repair] Tables:", JSON.stringify(tables));

  const pushCols = await p.$queryRawUnsafe(`SELECT name FROM pragma_table_info('PushSubscription')`);
  console.log("[repair] PushSubscription cols:", JSON.stringify(pushCols));

  const jobCols = await p.$queryRawUnsafe(`SELECT name FROM pragma_table_info('NotificationJob')`);
  console.log("[repair] NotificationJob cols:", JSON.stringify(jobCols));

  await p.$disconnect();
  console.log("[repair] Done!");
}

run().catch(e=>{console.error("[repair] Fatal:",e.message);process.exit(1)});
