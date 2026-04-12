package dev.convocados.wear.data.auth

import android.content.Context
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject
import javax.inject.Singleton

data class OAuthTokens(
    val accessToken: String,
    val refreshToken: String,
    val expiresAt: Long,
)

@Singleton
class WearTokenStore @Inject constructor(@ApplicationContext context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = try {
        createEncryptedPrefs(context)
    } catch (e: Exception) {
        Log.e("WearTokenStore", "EncryptedSharedPreferences init failed, clearing", e)
        context.deleteSharedPreferences("convocados_wear_tokens")
        createEncryptedPrefs(context)
    }

    private fun createEncryptedPrefs(context: Context) = EncryptedSharedPreferences.create(
        context,
        "convocados_wear_tokens",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    private val _isAuthenticated = MutableStateFlow(getTokens() != null)
    val isAuthenticated: StateFlow<Boolean> = _isAuthenticated

    fun getTokens(): OAuthTokens? {
        val access = prefs.getString("access_token", null) ?: return null
        val refresh = prefs.getString("refresh_token", null) ?: return null
        val expires = prefs.getLong("expires_at", 0)
        return OAuthTokens(access, refresh, expires)
    }

    fun setTokens(tokens: OAuthTokens) {
        prefs.edit()
            .putString("access_token", tokens.accessToken)
            .putString("refresh_token", tokens.refreshToken)
            .putLong("expires_at", tokens.expiresAt)
            .apply()
        _isAuthenticated.value = true
    }

    fun clearTokens() {
        prefs.edit().clear().apply()
        _isAuthenticated.value = false
    }

    fun isExpired(): Boolean {
        val tokens = getTokens() ?: return true
        return System.currentTimeMillis() >= tokens.expiresAt - 60_000
    }

    fun getServerUrl(): String =
        prefs.getString("server_url", null) ?: DEFAULT_SERVER_URL

    fun setServerUrl(url: String) {
        prefs.edit().putString("server_url", url).apply()
    }

    companion object {
        const val DEFAULT_SERVER_URL = "https://convocados.fly.dev"
    }
}
