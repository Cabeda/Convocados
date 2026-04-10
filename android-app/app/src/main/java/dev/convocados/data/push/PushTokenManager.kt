package dev.convocados.data.push

import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import dev.convocados.data.api.ApiClient
import dev.convocados.data.api.ApiException
import dev.convocados.data.auth.TokenStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.Serializable
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

@Serializable
data class RegisterTokenRequest(val token: String, val platform: String, val locale: String)

@Serializable
data class DeleteTokenRequest(val token: String)

@Singleton
class PushTokenManager @Inject constructor(
    private val apiClient: ApiClient,
    private val tokenStore: TokenStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var lastRegisteredToken: String? = null

    /** Called by FCM when a new token is generated */
    fun onNewToken(token: String) {
        if (!tokenStore.isAuthenticated.value) return
        scope.launch { registerToken(token) }
    }

    /** Register the current FCM token with the server. Call after login. */
    fun registerCurrentToken() {
        scope.launch {
            try {
                val token = FirebaseMessaging.getInstance().token.await()
                registerToken(token)
            } catch (e: Exception) {
                Log.e("PushToken", "Failed to get FCM token", e)
            }
        }
    }

    /** Unregister the token from the server. Call before logout. */
    fun unregisterCurrentToken() {
        val token = lastRegisteredToken ?: return
        scope.launch {
            try {
                apiClient.delete<Map<String, Boolean>>("/api/push/app-token", DeleteTokenRequest(token))
                lastRegisteredToken = null
                Log.d("PushToken", "Token unregistered")
            } catch (e: Exception) {
                Log.e("PushToken", "Failed to unregister token", e)
            }
        }
    }

    private suspend fun registerToken(token: String) {
        try {
            val locale = Locale.getDefault().language.take(2)
            apiClient.post<Map<String, Boolean>>(
                "/api/push/app-token",
                RegisterTokenRequest(token = token, platform = "android", locale = locale),
            )
            lastRegisteredToken = token
            Log.d("PushToken", "Token registered: ${token.take(20)}...")
        } catch (e: ApiException) {
            Log.e("PushToken", "Failed to register token: ${e.code} ${e.message}")
        } catch (e: Exception) {
            Log.e("PushToken", "Failed to register token", e)
        }
    }
}
