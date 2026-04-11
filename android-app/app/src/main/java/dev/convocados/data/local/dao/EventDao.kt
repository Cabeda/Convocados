package dev.convocados.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import dev.convocados.data.local.entity.EventEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface EventDao {
    @Query("SELECT * FROM events WHERE type = :type")
    fun getEventsByType(type: String): Flow<List<EventEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(events: List<EventEntity>)

    @Query("DELETE FROM events WHERE type = :type")
    suspend fun deleteByType(type: String)

    @Transaction
    suspend fun refreshEvents(type: String, events: List<EventEntity>) {
        deleteByType(type)
        insertAll(events)
    }
}
