package dev.convocados.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import dev.convocados.data.local.dao.EventDao
import dev.convocados.data.local.dao.EventDetailDao
import dev.convocados.data.local.dao.UserDao
import dev.convocados.data.local.entity.EventDetailEntity
import dev.convocados.data.local.entity.EventEntity
import dev.convocados.data.local.entity.GameHistoryEntity
import dev.convocados.data.local.entity.PlayerEntity
import dev.convocados.data.local.entity.UserProfileEntity

@Database(
    entities = [
        EventEntity::class,
        UserProfileEntity::class,
        EventDetailEntity::class,
        PlayerEntity::class,
        GameHistoryEntity::class
    ],
    version = 5,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun eventDao(): EventDao
    abstract fun eventDetailDao(): EventDetailDao
    abstract fun userDao(): UserDao

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
    }
}
