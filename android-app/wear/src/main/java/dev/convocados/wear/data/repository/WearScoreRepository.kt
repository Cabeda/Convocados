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
    fun observePendingCount(): Flow<Int> = pendingScoreDao.observeCount()

    fun observeStuckCount(): Flow<Int> = pendingScoreDao.observeStuckCount(MAX_ATTEMPTS)

    suspend fun submitScore(
        eventId: String,
        historyId: String,
        scoreOne: Int,
        scoreTwo: Int,
        teamOneName: String,
        teamTwoName: String,
    ): Result<Unit> {
        // Snapshot the pre-edit value so a later sync can detect concurrent edits.
        val base = historyDao.getLatestHistory(historyId)?.let { it.scoreOne to it.scoreTwo }
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
                    basedOnScoreOne = base?.first,
                    basedOnScoreTwo = base?.second,
                )
            )
            Result.failure(e)
        }
    }

    /** Attempt every pending score once. Stops auto-retrying past the cap (items
     *  stay queued and surfaced, never silently dropped). A server value that
     *  changed since our base is a concurrent phone edit — left queued rather
     *  than clobbered. */
    suspend fun syncPendingScores(): Int {
        val pending = pendingScoreDao.getAll()
        var synced = 0
        for (score in pending) {
            if (score.retryCount >= MAX_ATTEMPTS) continue
            try {
                val server = client.get<dev.convocados.wear.data.api.GameHistory>(
                    "/api/events/${score.eventId}/history/${score.historyId}"
                )
                // Already synced (idempotent).
                if (server.scoreOne == score.scoreOne && server.scoreTwo == score.scoreTwo) {
                    pendingScoreDao.delete(score)
                    synced++
                    continue
                }
                val baseMatches = score.basedOnScoreOne == null ||
                    (server.scoreOne == score.basedOnScoreOne && server.scoreTwo == score.basedOnScoreTwo)
                if (baseMatches) {
                    client.patch<dev.convocados.wear.data.api.GameHistory>(
                        "/api/events/${score.eventId}/history/${score.historyId}",
                        ScoreRequest(score.scoreOne, score.scoreTwo),
                    )
                    pendingScoreDao.delete(score)
                    synced++
                } else {
                    // Concurrent edit from the phone — keep local queued as a conflict.
                    pendingScoreDao.incrementRetry(score.id)
                }
            } catch (e: Exception) {
                pendingScoreDao.incrementRetry(score.id)
                Log.w("WearScoreRepo", "Failed to sync score ${score.id}", e)
            }
        }
        return synced
    }

    /** Discard stuck pending scores (user-initiated). */
    suspend fun discardStuckScores() {
        pendingScoreDao.getAll()
            .filter { it.retryCount >= MAX_ATTEMPTS }
            .forEach { pendingScoreDao.deleteById(it.id) }
    }

    companion object {
        private const val MAX_ATTEMPTS = 8
    }
}
