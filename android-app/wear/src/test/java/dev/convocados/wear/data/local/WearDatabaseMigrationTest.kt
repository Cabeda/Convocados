package dev.convocados.wear.data.local

import androidx.sqlite.db.SupportSQLiteDatabase
import io.mockk.mockk
import io.mockk.verify
import org.junit.Test

class WearDatabaseMigrationTest {
    @Test
    fun `v5 to v6 adds nullable set columns without dropping queued scores`() {
        val db = mockk<SupportSQLiteDatabase>(relaxed = true)

        WearDatabase.MIGRATION_5_6.migrate(db)

        verify(exactly = 1) { db.execSQL("ALTER TABLE `pending_scores` ADD COLUMN `scoreSetsJson` TEXT") }
        verify(exactly = 1) { db.execSQL("ALTER TABLE `pending_scores` ADD COLUMN `basedOnScoreSetsJson` TEXT") }
        verify(exactly = 1) { db.execSQL("ALTER TABLE `wear_history` ADD COLUMN `scoreSetsJson` TEXT") }
    }

    @Test
    fun `v6 to v7 adds baseline capture marker without dropping queued scores`() {
        val db = mockk<SupportSQLiteDatabase>(relaxed = true)

        WearDatabase.MIGRATION_6_7.migrate(db)

        verify(exactly = 1) { db.execSQL("ALTER TABLE `pending_scores` ADD COLUMN `baselineCaptured` INTEGER NOT NULL DEFAULT 0") }
    }

    @Test
    fun `v7 to v8 creates the pending actions queue without dropping existing queues`() {
        val db = mockk<SupportSQLiteDatabase>(relaxed = true)

        WearDatabase.MIGRATION_7_8.migrate(db)

        verify(exactly = 1) {
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS `pending_actions` (" +
                    "`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                    "`kind` TEXT NOT NULL, " +
                    "`eventId` TEXT NOT NULL, " +
                    "`playerName` TEXT, " +
                    "`idempotencyKey` TEXT, " +
                    "`createdAt` INTEGER NOT NULL, " +
                    "`retryCount` INTEGER NOT NULL, " +
                    "`needsSignIn` INTEGER NOT NULL DEFAULT 0)",
            )
        }
    }
}
