package dev.convocados.data.auth

/**
 * Storage for the OAuth token pair. Abstracted so [dev.convocados.data.api.ApiClient]
 * can be unit-tested against an in-memory fake instead of the encrypted
 * prefs-backed [TokenStore].
 */
interface OAuthTokenStorage {
    fun getTokens(): OAuthTokens?
    fun setTokens(tokens: OAuthTokens)
    fun clearTokens()
    fun getServerUrl(): String
}
