package dev.convocados.wear.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.entity.PendingScoreEntity
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity

@Database(
    entities = [
        WearGameEntity::class,
        PendingScoreEntity::class,
        WearHistoryEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
abstract class WearDatabase : RoomDatabase() {
    abstract fun gameDao(): WearGameDao
    abstract fun historyDao(): WearHistoryDao
    abstract fun pendingScoreDao(): PendingScoreDao
}
