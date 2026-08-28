package dev.convocados.wear.data.repository

import android.util.Log
import dev.convocados.wear.data.api.ApiException
import dev.convocados.wear.data.api.ScalarScoreRequest
import dev.convocados.wear.data.api.ScoreRequest
import dev.convocados.wear.data.api.SetScore
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.entity.PendingScoreEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
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
        scoreSets: List<SetScore>? = null,
    ): Result<Unit> {
        // Snapshot the pre-edit value so a later sync can detect concurrent edits.
        val base = historyDao.getHistoryById(historyId)
        val baseScoreSetsJson = base?.scoreSetsJson
        val scoreSetsJson = scoreSets?.let { Json.encodeToString(it) }
        historyDao.updateScore(historyId, scoreOne, scoreTwo, scoreSetsJson)
        return try {
            client.patchGameHistory(
                "/api/events/$eventId/history/$historyId",
                if (scoreSets != null) ScoreRequest(scoreOne, scoreTwo, scoreSets)
                else ScalarScoreRequest(scoreOne, scoreTwo),
            )
            Result.success(Unit)
        } catch (e: ApiException) {
            // A server-side validation/authentication failure is not an offline
            // condition; retrying it would only duplicate an invalid queue item.
            Log.w("WearScoreRepo", "Score submit rejected by server", e)
            Result.failure(e)
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
                    basedOnScoreOne = base?.scoreOne,
                    basedOnScoreTwo = base?.scoreTwo,
                    scoreSetsJson = scoreSetsJson,
                    basedOnScoreSetsJson = baseScoreSetsJson,
                    baselineCaptured = true,
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
                val server = client.getGameHistory(
                    "/api/events/${score.eventId}/history/${score.historyId}"
                )
                val serverScoreSetsJson = server.scoreSets?.let { Json.encodeToString(it) }
                // Already synced (idempotent).
                if (server.scoreOne == score.scoreOne && server.scoreTwo == score.scoreTwo && serverScoreSetsJson == score.scoreSetsJson) {
                    pendingScoreDao.delete(score)
                    synced++
                    continue
                }
                val baseMatches = if (!score.baselineCaptured) {
                    // v6 queue rows predate the marker. Preserve their old
                    // fail-open behavior for an unknown scalar baseline.
                    score.basedOnScoreOne == null ||
                        (server.scoreOne == score.basedOnScoreOne && server.scoreTwo == score.basedOnScoreTwo)
                } else {
                    server.scoreOne == score.basedOnScoreOne &&
                        server.scoreTwo == score.basedOnScoreTwo &&
                        serverScoreSetsJson == score.basedOnScoreSetsJson
                }
                if (baseMatches) {
                    val request: Any = score.scoreSetsJson?.let {
                        ScoreRequest(score.scoreOne, score.scoreTwo, Json.decodeFromString<List<SetScore>>(it))
                    } ?: ScalarScoreRequest(score.scoreOne, score.scoreTwo)
                    client.patchGameHistory(
                        "/api/events/${score.eventId}/history/${score.historyId}",
                        request,
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
