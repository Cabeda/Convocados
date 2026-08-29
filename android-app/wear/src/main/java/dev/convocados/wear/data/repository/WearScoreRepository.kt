package dev.convocados.wear.data.repository

import android.util.Log
import dev.convocados.wear.data.api.ApiException
import dev.convocados.wear.data.api.GameHistory
import dev.convocados.wear.data.api.ScalarScoreRequest
import dev.convocados.wear.data.api.ScoreRequest
import dev.convocados.wear.data.api.SetScore
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.entity.PendingScoreEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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

    private val scoreMutex = Mutex()

    suspend fun submitScore(
        eventId: String,
        historyId: String,
        scoreOne: Int,
        scoreTwo: Int,
        teamOneName: String,
        teamTwoName: String,
        scoreSets: List<SetScore>? = null,
    ): Result<Unit> = scoreMutex.withLock {
        submitScoreInternal(eventId, historyId, scoreOne, scoreTwo, teamOneName, teamTwoName, scoreSets)
    }

    private suspend fun submitScoreInternal(
        eventId: String,
        historyId: String,
        scoreOne: Int,
        scoreTwo: Int,
        teamOneName: String,
        teamTwoName: String,
        scoreSets: List<SetScore>? = null,
    ): Result<Unit> {
        // When replacing an offline edit, retain the earliest queued row's
        // server baseline; Room contains the previous optimistic target.
        val queuedBaseline = pendingScoreDao.getByHistory(eventId, historyId).firstOrNull()
        val base = historyDao.getHistoryById(historyId)
        val scoreSetsJson = scoreSets?.let { Json.encodeToString(it) }
        val pending = PendingScoreEntity(
            eventId = eventId,
            historyId = historyId,
            scoreOne = scoreOne,
            scoreTwo = scoreTwo,
            teamOneName = teamOneName,
            teamTwoName = teamTwoName,
            basedOnScoreOne = if (queuedBaseline != null) queuedBaseline.basedOnScoreOne else base?.scoreOne,
            basedOnScoreTwo = if (queuedBaseline != null) queuedBaseline.basedOnScoreTwo else base?.scoreTwo,
            scoreSetsJson = scoreSetsJson,
            basedOnScoreSetsJson = if (queuedBaseline != null) {
                queuedBaseline.basedOnScoreSetsJson
            } else {
                base?.scoreSetsJson
            },
            baselineCaptured = queuedBaseline?.baselineCaptured ?: (base != null),
        )
        historyDao.updateScore(historyId, scoreOne, scoreTwo, scoreSetsJson)

        // A newer foreground edit must not overwrite a phone edit that arrived
        // after the original offline baseline was captured. Verify the remote
        // state before issuing a direct PATCH whenever an older edit is queued.
        if (queuedBaseline != null) {
            try {
                val server = client.getGameHistory(historyPath(eventId, historyId))
                val scoreRedacted = server.isRedactedFor(pending)
                when {
                    server.matchesTarget(pending) -> {
                        pendingScoreDao.deleteByHistory(eventId, historyId)
                        return Result.success(Unit)
                    }
                    !scoreRedacted && !server.matchesBaseline(pending) -> {
                        replacePendingScore(pending)
                        return Result.failure(ConcurrentScoreEditException())
                    }
                }
            } catch (e: ApiException) {
                if (isRetryableApiException(e)) {
                    replacePendingScore(pending)
                } else {
                    pendingScoreDao.deleteByHistory(eventId, historyId)
                    restoreCachedScore(pending)
                }
                Log.w("WearScoreRepo", "Could not verify queued score before submit", e)
                return Result.failure(e)
            } catch (e: Exception) {
                // Without a fresh remote read, keep the newest target queued
                // against the original baseline rather than issuing an unsafe PATCH.
                replacePendingScore(pending)
                Log.w("WearScoreRepo", "Could not verify queued score before submit", e)
                return Result.failure(e)
            }
        }

        return try {
            client.patchGameHistory(
                historyPath(eventId, historyId),
                if (scoreSets != null) ScoreRequest(scoreOne, scoreTwo, scoreSets)
                else ScalarScoreRequest(scoreOne, scoreTwo),
            )
            // A successful newer write supersedes any older offline edits for
            // this history, including a failed structured-to-scalar conversion.
            pendingScoreDao.deleteByHistory(eventId, historyId)
            Result.success(Unit)
        } catch (e: ApiException) {
            if (isRetryableApiException(e)) {
                replacePendingScore(pending)
            } else {
                // A server-side validation failure is not an offline condition.
                pendingScoreDao.deleteByHistory(eventId, historyId)
                restoreCachedScore(pending)
            }
            Log.w("WearScoreRepo", "Score submit rejected by server", e)
            Result.failure(e)
        } catch (e: Exception) {
            Log.w("WearScoreRepo", "Score submit failed, queuing for sync", e)
            replacePendingScore(pending)
            Result.failure(e)
        }
    }

    private suspend fun replacePendingScore(score: PendingScoreEntity) {
        pendingScoreDao.deleteByHistory(score.eventId, score.historyId)
        pendingScoreDao.insert(score)
    }

    private fun historyPath(eventId: String, historyId: String): String =
        "/api/events/$eventId/history/$historyId"

    private fun GameHistory.matchesTarget(score: PendingScoreEntity): Boolean =
        matchesScore(score.scoreOne, score.scoreTwo, score.scoreSetsJson)

    private fun GameHistory.isRedactedFor(score: PendingScoreEntity): Boolean =
        scoreOne == null && scoreTwo == null && scoreSets == null && score.baselineCaptured &&
            (score.basedOnScoreOne != null || score.basedOnScoreTwo != null || score.basedOnScoreSetsJson != null)

    private fun GameHistory.matchesBaseline(score: PendingScoreEntity): Boolean {
        if (!score.baselineCaptured && score.basedOnScoreSetsJson == null) {
            // v6 queue rows without a structured baseline predate the marker.
            // Preserve their old fail-open behavior for an unknown scalar baseline.
            return score.basedOnScoreOne == null ||
                (scoreOne == score.basedOnScoreOne && scoreTwo == score.basedOnScoreTwo)
        }
        return matchesScore(score.basedOnScoreOne, score.basedOnScoreTwo, score.basedOnScoreSetsJson)
    }

    private fun GameHistory.matchesScore(
        expectedScoreOne: Int?,
        expectedScoreTwo: Int?,
        expectedScoreSetsJson: String?,
    ): Boolean {
        val serverScoreSetsJson = scoreSets?.let { Json.encodeToString(it) }
        return if (expectedScoreSetsJson != null) {
            serverScoreSetsJson == expectedScoreSetsJson
        } else {
            scoreOne == expectedScoreOne &&
                scoreTwo == expectedScoreTwo &&
                serverScoreSetsJson == null
        }
    }

    private class ConcurrentScoreEditException : Exception(
        "The score changed on another device while this edit was pending",
    )

    /** Attempt every pending score once. Stops auto-retrying past the cap (items
     *  stay queued and surfaced, never silently dropped). A server value that
     *  changed since our base is a concurrent phone edit — left queued rather
     *  than clobbered. */
    suspend fun syncPendingScores(): Int = scoreMutex.withLock {
        syncPendingScoresInternal()
    }

    private suspend fun syncPendingScoresInternal(): Int {
        val pending = pendingScoreDao.getAll()
        var synced = 0
        for (score in pending) {
            if (score.retryCount >= MAX_ATTEMPTS) continue
            try {
                val server = client.getGameHistory(historyPath(score.eventId, score.historyId))
                val scoreRedacted = server.isRedactedFor(score)
                val alreadySynced = !scoreRedacted && server.matchesTarget(score)
                if (alreadySynced) {
                    pendingScoreDao.delete(score)
                    synced++
                    continue
                }
                if (scoreRedacted || server.matchesBaseline(score)) {
                    val request: Any = score.scoreSetsJson?.let {
                        ScoreRequest(score.scoreOne, score.scoreTwo, Json.decodeFromString<List<SetScore>>(it))
                    } ?: ScalarScoreRequest(score.scoreOne, score.scoreTwo)
                    client.patchGameHistory(
                        historyPath(score.eventId, score.historyId),
                        request,
                    )
                    pendingScoreDao.delete(score)
                    synced++
                } else {
                    // Concurrent edit from the phone — keep local queued as a conflict.
                    pendingScoreDao.incrementRetry(score.id)
                }
            } catch (e: ApiException) {
                if (isRetryableApiException(e)) {
                    pendingScoreDao.incrementRetry(score.id)
                } else {
                    pendingScoreDao.delete(score)
                    restoreCachedScore(score)
                }
                Log.w("WearScoreRepo", "API rejected pending score ${score.id}", e)
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

    private suspend fun restoreCachedScore(score: PendingScoreEntity) {
        if (!score.baselineCaptured) return
        historyDao.updateScore(
            historyId = score.historyId,
            scoreOne = score.basedOnScoreOne,
            scoreTwo = score.basedOnScoreTwo,
            scoreSetsJson = score.basedOnScoreSetsJson,
        )
    }

    private fun isRetryableApiException(exception: ApiException): Boolean =
        exception.code == 0 || exception.code == 401 || exception.code == 403 ||
            exception.code == 408 || exception.code == 429 || exception.code >= 500

    companion object {
        private const val MAX_ATTEMPTS = 8
    }
}
