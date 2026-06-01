package dev.convocados.data.auth

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.*
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dev.convocados.data.api.ApiClient
import java.util.concurrent.TimeUnit

@HiltWorker
class TokenRefreshWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val tokenStore: TokenStore,
    private val apiClient: ApiClient,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val tokens = tokenStore.getTokens() ?: return Result.failure()
        val expiresIn = tokens.expiresAt - System.currentTimeMillis()
        // Only refresh if expiring within 15 minutes
        if (expiresIn > 15 * 60 * 1000) return Result.success()
        return try {
            apiClient.refreshToken()
            Log.d("TokenRefresh", "Token refreshed proactively")
            Result.success()
        } catch (e: Exception) {
            Log.e("TokenRefresh", "Proactive refresh failed", e)
            Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "token_refresh"

        fun schedule(workManager: WorkManager) {
            val request = PeriodicWorkRequestBuilder<TokenRefreshWorker>(45, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            workManager.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(workManager: WorkManager) {
            workManager.cancelUniqueWork(WORK_NAME)
        }
    }
}
