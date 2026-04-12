package dev.convocados.data.auth

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Syncs auth tokens to connected Wear OS devices via the Wearable Data Layer API.
 * Called after login/token refresh on the phone app.
 */
@Singleton
class WearAuthSync @Inject constructor(
    @ApplicationContext private val context: Context,
    private val tokenStore: TokenStore,
) {
    suspend fun syncTokens() {
        val tokens = tokenStore.getTokens() ?: return
        try {
            val request = PutDataMapRequest.create("/auth").apply {
                dataMap.putString("access_token", tokens.accessToken)
                dataMap.putString("refresh_token", tokens.refreshToken)
                dataMap.putLong("expires_at", tokens.expiresAt)
                dataMap.putString("server_url", tokenStore.getServerUrl())
                // Force update even if data hasn't changed
                dataMap.putLong("timestamp", System.currentTimeMillis())
            }.asPutDataRequest().setUrgent()

            Wearable.getDataClient(context).putDataItem(request).await()
            Log.d("WearAuthSync", "Tokens synced to watch")
        } catch (e: Exception) {
            // Wearable API not available (no watch paired) — ignore silently
            Log.d("WearAuthSync", "No watch connected or Wearable API unavailable", e)
        }
    }

    suspend fun clearTokens() {
        try {
            val request = PutDataMapRequest.create("/auth").apply {
                // Empty data signals logout
            }.asPutDataRequest().setUrgent()

            Wearable.getDataClient(context).deleteDataItems(request.uri).await()
            Log.d("WearAuthSync", "Tokens cleared on watch")
        } catch (e: Exception) {
            Log.d("WearAuthSync", "No watch connected or Wearable API unavailable", e)
        }
    }
}
