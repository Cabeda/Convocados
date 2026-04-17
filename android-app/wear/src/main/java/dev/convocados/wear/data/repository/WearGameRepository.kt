package dev.convocados.wear.data.repository

import android.util.Log
import dev.convocados.wear.data.api.ScoreRequest
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.entity.PendingScoreEntity
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WearGameRepository @Inject constructor(
    private val client: WearApiClient,
    private val gameDao: WearGameDao,
    private val historyDao: WearHistoryDao,
    private val pendingScoreDao: PendingScoreDao,
) {
    /** Observable list of all cached games, sorted by dateTime. */
    fun observeGames(): Flow<List<WearGameEntity>> = gameDao.getAllGames()

    /** Observable latest history for a game. */
    fun observeLatestHistory(eventId: String): Flow<WearHistoryEntity?> =
        historyDao.observeLatestHistory(eventId)

    /** Observable count of pending (unsynced) scores. */
    fun observePendingCount(): Flow<Int> = pendingScoreDao.observeCount()

    /** Refresh games from the API, falling back to cache on failure. */
    suspend fun refreshGames(): Result<Unit> = try {
        val response = client.get<dev.convocados.wear.data.api.MyGamesResponse>("/api/me/games")
        val owned = response.owned.map { it.toEntity("owned") }
        val joined = response.joined.map { it.toEntity("joined") }
        gameDao.refreshGames("owned", owned)
        gameDao.refreshGames("joined", joined)
        Result.success(Unit)
    } catch (e: Exception) {
        Log.w("WearGameRepo", "Failed to refresh games", e)
        Result.failure(e)
    }

    /** Refresh history for a specific event. */
    suspend fun refreshHistory(eventId: String): Result<Unit> = try {
        val history = client.get<dev.convocados.wear.data.api.PaginatedHistory>("/api/events/$eventId/history")
        historyDao.refreshHistory(
            eventId,
            history.data.map { it.toHistoryEntity(eventId) }
        )
        Result.success(Unit)
    } catch (e: Exception) {
        Log.w("WearGameRepo", "Failed to refresh history for $eventId", e)
        Result.failure(e)
    }

    /** Get the latest history entry for a game (from cache). */
    suspend fun getLatestHistory(eventId: String): WearHistoryEntity? =
        historyDao.getLatestHistory(eventId)

    /** Get a cached game by ID. */
    suspend fun getGame(eventId: String): WearGameEntity? = gameDao.getGame(eventId)

    /**
     * Submit a score. Tries the API first; if offline, queues it locally.
     * Updates the local cache optimistically either way.
     */
    suspend fun submitScore(
        eventId: String,
        historyId: String,
        scoreOne: Int,
        scoreTwo: Int,
        teamOneName: String,
        teamTwoName: String,
    ): Result<Unit> {
        // Optimistically update local cache
        historyDao.updateScore(historyId, scoreOne, scoreTwo)

        return try {
            client.patch<dev.convocados.wear.data.api.GameHistory>(
                "/api/events/$eventId/history/$historyId",
                ScoreRequest(scoreOne, scoreTwo),
            )
            Result.success(Unit)
        } catch (e: Exception) {
            Log.w("WearGameRepo", "Score submit failed, queuing for sync", e)
            pendingScoreDao.insert(
                PendingScoreEntity(
                    eventId = eventId,
                    historyId = historyId,
                    scoreOne = scoreOne,
                    scoreTwo = scoreTwo,
                    teamOneName = teamOneName,
                    teamTwoName = teamTwoName,
                )
            )
            Result.failure(e) // Queued for later — let UI know it's offline
        }
    }

    /** Sync all pending scores. Returns number of successfully synced items. */
    suspend fun syncPendingScores(): Int {
        val pending = pendingScoreDao.getAll()
        var synced = 0
        for (score in pending) {
            try {
                client.patch<dev.convocados.wear.data.api.GameHistory>(
                    "/api/events/${score.eventId}/history/${score.historyId}",
                    ScoreRequest(score.scoreOne, score.scoreTwo),
                )
                pendingScoreDao.delete(score)
                synced++
            } catch (e: Exception) {
                pendingScoreDao.incrementRetry(score.id)
                Log.w("WearGameRepo", "Failed to sync score ${score.id}", e)
            }
        }
        pendingScoreDao.deleteStale()
        return synced
    }

    // ── Mappers ──────────────────────────────────────────────────────────

    private fun dev.convocados.wear.data.api.EventSummary.toEntity(type: String) = WearGameEntity(
        id = id,
        title = title,
        location = location,
        dateTime = dateTime,
        sport = sport,
        maxPlayers = maxPlayers,
        playerCount = playerCount,
        teamOneName = "Team 1",
        teamTwoName = "Team 2",
        isRecurring = isRecurring,
        type = type,
    )

    private fun dev.convocados.wear.data.api.GameHistory.toHistoryEntity(eventId: String) =
        WearHistoryEntity(
            id = id,
            eventId = eventId,
            dateTime = dateTime,
            scoreOne = scoreOne,
            scoreTwo = scoreTwo,
            teamOneName = teamOneName,
            teamTwoName = teamTwoName,
            editable = editable,
        )
}
