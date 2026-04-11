package dev.convocados.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
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
    version = 2,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun eventDao(): EventDao
    abstract fun eventDetailDao(): EventDetailDao
    abstract fun userDao(): UserDao
}
