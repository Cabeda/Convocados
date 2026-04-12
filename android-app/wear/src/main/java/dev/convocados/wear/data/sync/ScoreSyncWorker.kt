package dev.convocados.wear.data.sync

import android.content.Context
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
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val repository: WearGameRepository,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            val synced = repository.syncPendingScores()
            Log.d("ScoreSyncWorker", "Synced $synced pending scores")
            Result.success()
        } catch (e: Exception) {
            Log.e("ScoreSyncWorker", "Sync failed", e)
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }

    companion object {
        private const val UNIQUE_WORK_NAME = "score_sync"

        /** Enqueue a one-time sync attempt (e.g. after entering a score offline). */
        fun enqueueOneTime(context: Context) {
            val request = OneTimeWorkRequestBuilder<ScoreSyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.REPLACE, request)
        }

        /** Schedule periodic sync every 15 minutes when connected. */
        fun schedulePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<ScoreSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()

            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(
                    "${UNIQUE_WORK_NAME}_periodic",
                    ExistingPeriodicWorkPolicy.KEEP,
                    request,
                )
        }
    }
}
