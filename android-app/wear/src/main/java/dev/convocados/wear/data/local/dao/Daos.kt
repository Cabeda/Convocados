package dev.convocados.wear.data.local.dao

import androidx.room.*
import dev.convocados.wear.data.local.entity.PendingActionEntity
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

    @Query("UPDATE wear_games SET teamOneName = :teamOneName, teamTwoName = :teamTwoName WHERE id = :id")
    suspend fun updateTeamNames(id: String, teamOneName: String, teamTwoName: String)
}

@Dao
interface WearHistoryDao {
    @Query("SELECT * FROM wear_history WHERE eventId = :eventId ORDER BY dateTime DESC LIMIT 1")
    suspend fun getLatestHistory(eventId: String): WearHistoryEntity?

    @Query("SELECT * FROM wear_history WHERE eventId = :eventId")
    suspend fun getByEvent(eventId: String): List<WearHistoryEntity>

    @Query("SELECT * FROM wear_history WHERE id = :historyId LIMIT 1")
    suspend fun getHistoryById(historyId: String): WearHistoryEntity?

    /** Latest history entry whose dateTime falls within [startOfDayIso, endOfDayIso) — the active game (issue #691). */
    @Query("SELECT * FROM wear_history WHERE eventId = :eventId AND dateTime >= :startOfDayIso AND dateTime < :endOfDayIso ORDER BY dateTime DESC LIMIT 1")
    suspend fun getLatestTodayHistory(eventId: String, startOfDayIso: String, endOfDayIso: String): WearHistoryEntity?

    /** Observe the latest history entry whose dateTime falls within [startOfDayIso, endOfDayIso). */
    @Query("SELECT * FROM wear_history WHERE eventId = :eventId AND dateTime >= :startOfDayIso AND dateTime < :endOfDayIso ORDER BY dateTime DESC LIMIT 1")
    fun observeLatestTodayHistory(eventId: String, startOfDayIso: String, endOfDayIso: String): Flow<WearHistoryEntity?>

    /** Observe the most recent history entry for the event regardless of day.
     *  The score screen scopes by the game's own dateTime (a one-off game may be
     *  in the past or future), so "today" is the wrong boundary there. */
    @Query("SELECT * FROM wear_history WHERE eventId = :eventId ORDER BY dateTime DESC LIMIT 1")
    fun observeLatestHistoryForEvent(eventId: String): Flow<WearHistoryEntity?>

    /** All cached history, most recent first (for the wrist history screen). */
    @Query("SELECT * FROM wear_history ORDER BY dateTime DESC")
    fun observeAllHistory(): Flow<List<WearHistoryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(history: List<WearHistoryEntity>)

    @Query("DELETE FROM wear_history WHERE eventId = :eventId")
    suspend fun deleteByEvent(eventId: String)

    @Transaction
    suspend fun refreshHistory(eventId: String, history: List<WearHistoryEntity>) {
        deleteByEvent(eventId)
        insertAll(history)
    }

    @Query("UPDATE wear_history SET scoreOne = :scoreOne, scoreTwo = :scoreTwo, scoreSetsJson = :scoreSetsJson WHERE id = :historyId")
    suspend fun updateScore(historyId: String, scoreOne: Int?, scoreTwo: Int?, scoreSetsJson: String? = null)

    @Query("DELETE FROM wear_history WHERE id = :historyId")
    suspend fun deleteById(historyId: String)
}

@Dao
interface PendingScoreDao {
    @Query("SELECT * FROM pending_scores ORDER BY createdAt ASC")
    suspend fun getAll(): List<PendingScoreEntity>

    @Query("SELECT COUNT(*) FROM pending_scores")
    fun observeCount(): Flow<Int>

    /** Items that have hit the retry cap and are no longer auto-attempted. */
    @Query("SELECT COUNT(*) FROM pending_scores WHERE retryCount >= :cap")
    fun observeStuckCount(cap: Int): Flow<Int>

    @Query("SELECT * FROM pending_scores WHERE eventId = :eventId AND historyId = :historyId ORDER BY createdAt ASC")
    suspend fun getByHistory(eventId: String, historyId: String): List<PendingScoreEntity>

    @Query("DELETE FROM pending_scores WHERE eventId = :eventId AND historyId = :historyId")
    suspend fun deleteByHistory(eventId: String, historyId: String)

    @Insert
    suspend fun insert(score: PendingScoreEntity)

    @Delete
    suspend fun delete(score: PendingScoreEntity)

    @Query("UPDATE pending_scores SET retryCount = retryCount + 1 WHERE id = :id")
    suspend fun incrementRetry(id: Long)

    @Query("UPDATE pending_scores SET historyId = :toHistoryId WHERE historyId = :fromHistoryId")
    suspend fun rekeyHistory(fromHistoryId: String, toHistoryId: String)

    @Query("DELETE FROM pending_scores WHERE id = :id")
    suspend fun deleteById(id: Long)
}

@Dao
interface WearPlayerDao {
    @Query("SELECT * FROM wear_players WHERE eventId = :eventId ORDER BY `order` ASC")
    fun observePlayers(eventId: String): Flow<List<WearPlayerEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(players: List<WearPlayerEntity>)

    @Query("SELECT * FROM wear_players WHERE id = :id")
    suspend fun getById(id: String): WearPlayerEntity?

    @Query("DELETE FROM wear_players WHERE id = :id")
    suspend fun deleteById(id: String)

    /**
     * Replace the server roster, but keep the `local-player:` echoes of adds
     * that are still queued (#1343): a refresh must not erase a player the
     * organizer just added offline. A replay removes its own echo once the
     * server row exists.
     */
    @Query("DELETE FROM wear_players WHERE eventId = :eventId AND id NOT LIKE 'local-player:%'")
    suspend fun deleteServerPlayers(eventId: String)

    @Transaction
    suspend fun refreshPlayers(eventId: String, players: List<WearPlayerEntity>) {
        deleteServerPlayers(eventId)
        insertAll(players)
    }
}

@Dao
interface PendingRosterChangeDao {
    @Query("SELECT * FROM pending_roster_changes ORDER BY createdAt ASC")
    suspend fun getAll(): List<PendingRosterChangeEntity>

    @Query("SELECT COUNT(*) FROM pending_roster_changes")
    fun observeCount(): Flow<Int>

    /** Items that have hit the retry cap and are no longer auto-attempted. */
    @Query("SELECT COUNT(*) FROM pending_roster_changes WHERE retryCount >= :cap")
    fun observeStuckCount(cap: Int): Flow<Int>

    @Insert
    suspend fun insert(change: PendingRosterChangeEntity)

    @Delete
    suspend fun delete(change: PendingRosterChangeEntity)

    @Query("UPDATE pending_roster_changes SET retryCount = retryCount + 1 WHERE id = :id")
    suspend fun incrementRetry(id: Long)

    @Query("DELETE FROM pending_roster_changes WHERE id = :id")
    suspend fun deleteById(id: Long)

    /**
     * Drop every queued change for an event. `updateTeams` always writes the
     * complete roster, so once one succeeds every earlier change for that event
     * is superseded — replaying them would undo the newer write (#1343).
     */
    @Query("DELETE FROM pending_roster_changes WHERE eventId = :eventId")
    suspend fun deleteByEventId(eventId: String)
}

@Dao
interface PendingActionDao {
    @Query("SELECT * FROM pending_actions WHERE kind = :kind ORDER BY createdAt ASC")
    suspend fun getByKind(kind: String): List<PendingActionEntity>

    @Query("SELECT * FROM pending_actions WHERE kind = :kind AND eventId = :eventId")
    suspend fun getByKindAndEvent(kind: String, eventId: String): List<PendingActionEntity>

    /** Names still queued, so the add-player screen can label them "Queued". */
    @Query("SELECT playerName FROM pending_actions WHERE kind = 'add_player' AND eventId = :eventId")
    fun observeAddNames(eventId: String): Flow<List<String>>

    @Insert
    suspend fun insert(action: PendingActionEntity)

    @Query("UPDATE pending_actions SET retryCount = retryCount + 1 WHERE id = :id")
    suspend fun incrementRetry(id: Long)

    @Query("DELETE FROM pending_actions WHERE id = :id")
    suspend fun deleteById(id: Long)
}
