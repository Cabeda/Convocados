package dev.convocados.wear.data.repository

import android.util.Log
import dev.convocados.wear.data.api.ScoreRequest
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.entity.PendingScoreEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WearScoreRepository @Inject constructor(
    private val client: WearApiClient,
    private val historyDao: WearHistoryDao,
    private val pendingScoreDao: PendingScoreDao,
) {
    /** Observable count of pending (unsynced) scores. */
    fun observePendingCount(): Flow<Int> = pendingScoreDao.observeCount()

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
        historyDao.updateScore(historyId, scoreOne, scoreTwo)

        return try {
            client.patch<dev.convocados.wear.data.api.GameHistory>(
                "/api/events/$eventId/history/$historyId",
                ScoreRequest(scoreOne, scoreTwo),
            )
            Result.success(Unit)
        } catch (e: Exception) {
            Log.w("WearScoreRepo", "Score submit failed, queuing for sync", e)
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
            Result.failure(e)
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
                Log.w("WearScoreRepo", "Failed to sync score ${score.id}", e)
            }
        }
        pendingScoreDao.deleteStale()
        return synced
    }
}
