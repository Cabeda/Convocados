package dev.convocados.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import dev.convocados.data.local.dao.EventDao
import dev.convocados.data.local.dao.EventDetailDao
import dev.convocados.data.local.dao.RecentlyViewedDao
import dev.convocados.data.local.dao.UserDao
import dev.convocados.data.local.entity.EventDetailEntity
import dev.convocados.data.local.entity.EventEntity
import dev.convocados.data.local.entity.GameHistoryEntity
import dev.convocados.data.local.entity.PlayerEntity
import dev.convocados.data.local.entity.RecentlyViewedEventEntity
import dev.convocados.data.local.entity.UserProfileEntity

@Database(
    entities = [
        EventEntity::class,
        UserProfileEntity::class,
        EventDetailEntity::class,
        PlayerEntity::class,
        GameHistoryEntity::class,
        RecentlyViewedEventEntity::class
    ],
    version = 9,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun eventDao(): EventDao
    abstract fun eventDetailDao(): EventDetailDao
    abstract fun userDao(): UserDao
    abstract fun recentlyViewedDao(): RecentlyViewedDao

    companion object {
        /**
         * Schema v4 shipped two different layouts: the pre-August 2026 build (no
         * `players.image`) and the "profile avatars" build (`players.image`, added without
         * bumping the version). The guard keeps both existing v4 databases migrateable.
         */
        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                val hasImage = db.query("PRAGMA table_info(`players`)").use { cursor ->
                    var found = false
                    while (cursor.moveToNext()) {
                        if (cursor.getString(1) == "image") {
                            found = true
                            break
                        }
                    }
                    found
                }
                if (!hasImage) {
                    db.execSQL("ALTER TABLE `players` ADD COLUMN `image` TEXT")
                }
            }
        }

        /** v6: recently-viewed events (link visits included). */
        val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `recently_viewed_events` (" +
                        "`eventId` TEXT NOT NULL PRIMARY KEY, " +
                        "`title` TEXT NOT NULL, " +
                        "`location` TEXT NOT NULL, " +
                        "`dateTime` TEXT NOT NULL, " +
                        "`sport` TEXT NOT NULL, " +
                        "`viewedAt` INTEGER NOT NULL)"
                )
            }
        }

        /** v7: persist pending-invite (invited) + declined rosters as JSON columns. */
        val MIGRATION_6_7 = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `event_details` ADD COLUMN `invitedJson` TEXT")
                db.execSQL("ALTER TABLE `event_details` ADD COLUMN `declinedJson` TEXT")
            }
        }

        /** v8: cache structured tennis/padel set scores as JSON. */
        val MIGRATION_7_8 = object : Migration(7, 8) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `game_history` ADD COLUMN `scoreSetsJson` TEXT")
            }
        }

        /** v9: cache Elo visibility settings with event details. */
        val MIGRATION_8_9 = object : Migration(8, 9) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `event_details` ADD COLUMN `eloEnabled` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `event_details` ADD COLUMN `hideEloInTeams` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `event_details` ADD COLUMN `showCompetitiveData` INTEGER NOT NULL DEFAULT 1")
            }
        }
    }
}
