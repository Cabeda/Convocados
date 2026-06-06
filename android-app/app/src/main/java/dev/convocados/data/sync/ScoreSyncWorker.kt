package dev.convocados.data.sync

import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.*
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.local.dao.PendingScoreDao
import java.util.concurrent.TimeUnit

@HiltWorker
class ScoreSyncWorker @AssistedInject constructor(
    @Assisted context: android.content.Context,
    @Assisted params: WorkerParameters,
    private val api: ConvocadosApi,
    private val pendingScoreDao: PendingScoreDao,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            val pending = pendingScoreDao.getAll()
            var synced = 0
            for (score in pending) {
                try {
                    api.updateScore(score.eventId, score.historyId, score.scoreOne, score.scoreTwo)
                    pendingScoreDao.delete(score)
                    synced++
                } catch (e: Exception) {
                    pendingScoreDao.incrementRetry(score.id)
                    Log.w("ScoreSyncWorker", "Failed to sync score ${score.id}", e)
                }
            }
            pendingScoreDao.deleteStale()
            Log.d("ScoreSyncWorker", "Synced $synced scores")
            Result.success()
        } catch (e: Exception) {
            Log.e("ScoreSyncWorker", "Sync failed", e)
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }

    companion object {
        private const val UNIQUE_WORK_NAME = "score_sync"

        private val connectedConstraint = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        fun enqueueOneTime(workManager: WorkManager) {
            val request = OneTimeWorkRequestBuilder<ScoreSyncWorker>()
                .setConstraints(connectedConstraint)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            workManager.enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.REPLACE, request)
        }
    }
}
