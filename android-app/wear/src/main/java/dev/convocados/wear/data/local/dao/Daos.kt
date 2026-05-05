package dev.convocados.wear.data.local.dao

import androidx.room.*
import dev.convocados.wear.data.local.entity.PendingRosterChangeEntity
import dev.convocados.wear.data.local.entity.PendingScoreEntity
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import dev.convocados.wear.data.local.entity.WearPlayerEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface WearGameDao {
    @Query("SELECT * FROM wear_games WHERE type NOT LIKE 'archived_%' ORDER BY dateTime ASC")
    fun getAllGames(): Flow<List<WearGameEntity>>

    @Query("SELECT * FROM wear_games WHERE type LIKE 'archived_%' ORDER BY dateTime DESC")
    fun getArchivedGames(): Flow<List<WearGameEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(games: List<WearGameEntity>)

    @Query("DELETE FROM wear_games WHERE type = :type")
    suspend fun deleteByType(type: String)

    @Transaction
    suspend fun refreshGames(type: String, games: List<WearGameEntity>) {
        deleteByType(type)
        insertAll(games)
    }

    @Query("SELECT * FROM wear_games WHERE id = :id")
    suspend fun getGame(id: String): WearGameEntity?
}

@Dao
interface WearHistoryDao {
    @Query("SELECT * FROM wear_history WHERE eventId = :eventId ORDER BY dateTime DESC LIMIT 1")
    suspend fun getLatestHistory(eventId: String): WearHistoryEntity?

    @Query("SELECT * FROM wear_history WHERE eventId = :eventId ORDER BY dateTime DESC LIMIT 1")
    fun observeLatestHistory(eventId: String): Flow<WearHistoryEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(history: List<WearHistoryEntity>)

    @Query("DELETE FROM wear_history WHERE eventId = :eventId")
    suspend fun deleteByEvent(eventId: String)

    @Transaction
    suspend fun refreshHistory(eventId: String, history: List<WearHistoryEntity>) {
        deleteByEvent(eventId)
        insertAll(history)
    }

    @Query("UPDATE wear_history SET scoreOne = :scoreOne, scoreTwo = :scoreTwo WHERE id = :historyId")
    suspend fun updateScore(historyId: String, scoreOne: Int, scoreTwo: Int)
}

@Dao
interface PendingScoreDao {
    @Query("SELECT * FROM pending_scores ORDER BY createdAt ASC")
    suspend fun getAll(): List<PendingScoreEntity>

    @Query("SELECT COUNT(*) FROM pending_scores")
    fun observeCount(): Flow<Int>

    @Insert
    suspend fun insert(score: PendingScoreEntity)

    @Delete
    suspend fun delete(score: PendingScoreEntity)

    @Query("UPDATE pending_scores SET retryCount = retryCount + 1 WHERE id = :id")
    suspend fun incrementRetry(id: Long)

    @Query("DELETE FROM pending_scores WHERE retryCount >= 5")
    suspend fun deleteStale()
}

@Dao
interface WearPlayerDao {
    @Query("SELECT * FROM wear_players WHERE eventId = :eventId ORDER BY `order` ASC")
    fun observePlayers(eventId: String): Flow<List<WearPlayerEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(players: List<WearPlayerEntity>)

    @Query("DELETE FROM wear_players WHERE eventId = :eventId")
    suspend fun deleteByEvent(eventId: String)

    @Transaction
    suspend fun refreshPlayers(eventId: String, players: List<WearPlayerEntity>) {
        deleteByEvent(eventId)
        insertAll(players)
    }
}

@Dao
interface PendingRosterChangeDao {
    @Query("SELECT * FROM pending_roster_changes ORDER BY createdAt ASC")
    suspend fun getAll(): List<PendingRosterChangeEntity>

    @Insert
    suspend fun insert(change: PendingRosterChangeEntity)

    @Delete
    suspend fun delete(change: PendingRosterChangeEntity)

    @Query("UPDATE pending_roster_changes SET retryCount = retryCount + 1 WHERE id = :id")
    suspend fun incrementRetry(id: Long)

    @Query("DELETE FROM pending_roster_changes WHERE retryCount >= 5")
    suspend fun deleteStale()
}
