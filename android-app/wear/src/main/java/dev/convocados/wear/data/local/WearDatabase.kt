package dev.convocados.wear.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import dev.convocados.wear.data.local.dao.PendingRosterChangeDao
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.dao.WearPlayerDao
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
    ],
    version = 3,
    exportSchema = false,
)
abstract class WearDatabase : RoomDatabase() {
    abstract fun gameDao(): WearGameDao
    abstract fun historyDao(): WearHistoryDao
    abstract fun pendingScoreDao(): PendingScoreDao
    abstract fun playerDao(): WearPlayerDao
    abstract fun pendingRosterChangeDao(): PendingRosterChangeDao
}
