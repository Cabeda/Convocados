package dev.convocados.wear.data.sync

import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.*
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dev.convocados.wear.data.repository.WearGameRepository
import java.util.concurrent.TimeUnit

/**
 * WorkManager worker that syncs pending scores when connectivity is available.
 * Enqueued as a unique periodic job and also triggered on-demand after score entry.
 */
@HiltWorker
class ScoreSyncWorker @AssistedInject constructor(
    @Assisted context: android.content.Context,
    @Assisted params: WorkerParameters,
    private val repository: WearGameRepository,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            val syncedScores = repository.syncPendingScores()
            val syncedRosters = repository.syncPendingRosterChanges()
            Log.d("ScoreSyncWorker", "Synced $syncedScores scores, $syncedRosters roster changes")
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

        /** Enqueue a one-time sync attempt (e.g. after entering a score offline). */
        fun enqueueOneTime(workManager: WorkManager) {
            val request = OneTimeWorkRequestBuilder<ScoreSyncWorker>()
                .setConstraints(connectedConstraint)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()

            workManager.enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.REPLACE, request)
        }

        /** Schedule periodic sync every 15 minutes when connected. */
        fun schedulePeriodic(workManager: WorkManager) {
            val request = PeriodicWorkRequestBuilder<ScoreSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(connectedConstraint)
                .build()

            workManager.enqueueUniquePeriodicWork(
                "${UNIQUE_WORK_NAME}_periodic",
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }
    }
}
