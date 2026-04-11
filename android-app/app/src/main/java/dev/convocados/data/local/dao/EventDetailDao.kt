package dev.convocados.data.local.dao

import androidx.room.*
import dev.convocados.data.local.entity.EventDetailEntity
import dev.convocados.data.local.entity.GameHistoryEntity
import dev.convocados.data.local.entity.PlayerEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface EventDetailDao {
    @Query("SELECT * FROM event_details WHERE id = :id")
    fun getEvent(id: String): Flow<EventDetailEntity?>

    @Query("SELECT * FROM players WHERE eventId = :eventId ORDER BY `order` ASC")
    fun getPlayers(eventId: String): Flow<List<PlayerEntity>>

    @Query("SELECT * FROM game_history WHERE eventId = :eventId ORDER BY dateTime DESC")
    fun getHistory(eventId: String): Flow<List<GameHistoryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertEvent(event: EventDetailEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPlayers(players: List<PlayerEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertHistory(history: List<GameHistoryEntity>)

    @Query("DELETE FROM players WHERE eventId = :eventId")
    suspend fun deletePlayers(eventId: String)

    @Query("DELETE FROM game_history WHERE eventId = :eventId")
    suspend fun deleteHistory(eventId: String)

    @Transaction
    suspend fun refreshEvent(
        event: EventDetailEntity,
        players: List<PlayerEntity>,
        history: List<GameHistoryEntity>
    ) {
        insertEvent(event)
        deletePlayers(event.id)
        insertPlayers(players)
        deleteHistory(event.id)
        insertHistory(history)
    }
}
