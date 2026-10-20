package dev.convocados.wear.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import dev.convocados.wear.data.local.dao.PendingActionDao
import dev.convocados.wear.data.local.dao.PendingRosterChangeDao
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.dao.WearPlayerDao
import dev.convocados.wear.data.local.entity.PendingActionEntity
import dev.convocados.wear.data.local.entity.PendingRosterChangeEntity
import dev.convocados.wear.data.local.entity.PendingScoreEntity
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import dev.convocados.wear.data.local.entity.WearPlayerEntity

@Database(
    entities = [
        WearGameEntity::class,
        PendingScoreEntity::class,
        WearHistoryEntity::class,
        WearPlayerEntity::class,
        PendingRosterChangeEntity::class,
        PendingActionEntity::class,
    ],
    version = 8,
    exportSchema = false,
)
abstract class WearDatabase : RoomDatabase() {
    abstract fun gameDao(): WearGameDao
    abstract fun historyDao(): WearHistoryDao
    abstract fun pendingScoreDao(): PendingScoreDao
    abstract fun playerDao(): WearPlayerDao
    abstract fun pendingRosterChangeDao(): PendingRosterChangeDao
    abstract fun pendingActionDao(): PendingActionDao

    companion object {
        /** v7 to v8: queue create-shaped watch actions (start game, add player). */
        val MIGRATION_7_8 = object : Migration(7, 8) {
            override fun migrate(db: SupportSQLiteDatabase) {
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

        /** v6 to v7: preserve whether a nullable score baseline was captured. */
        val MIGRATION_6_7 = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // Rows created before this marker cannot distinguish a captured
                // all-null baseline from an unavailable lookup. Keep them in the
                // legacy compatibility path rather than claiming certainty.
                db.execSQL("ALTER TABLE `pending_scores` ADD COLUMN `baselineCaptured` INTEGER NOT NULL DEFAULT 0")
            }
        }

        /** v6: add structured tennis/padel scores while preserving queued scores. */
        val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `pending_scores` ADD COLUMN `scoreSetsJson` TEXT")
                db.execSQL("ALTER TABLE `pending_scores` ADD COLUMN `basedOnScoreSetsJson` TEXT")
                db.execSQL("ALTER TABLE `wear_history` ADD COLUMN `scoreSetsJson` TEXT")
            }
        }
    }
}
