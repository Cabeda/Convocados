package dev.convocados.data.auth

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.convocados.data.api.ApiClient
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiClient: ApiClient,
    private val tokenStore: TokenStore,
) {
    fun startLogin(context: android.app.Activity) {
        val redirectUri = "convocados://auth"
        val url = apiClient.getLoginUrl(redirectUri)
        val intent = CustomTabsIntent.Builder().build()
        intent.launchUrl(context, Uri.parse(url))
    }

    suspend fun handleCallback(uri: Uri): Boolean {
        val code = uri.getQueryParameter("code") ?: return false
        val tokenResponse = apiClient.exchangeCode(code)
        tokenStore.setTokens(
            OAuthTokens(
                accessToken = tokenResponse.accessToken,
                refreshToken = tokenResponse.refreshToken ?: "",
                expiresAt = System.currentTimeMillis() + tokenResponse.expiresIn * 1000,
            )
        )
        return true
    }

    fun logout() {
        tokenStore.clearTokens()
    }
}
