package dev.convocados.wear.data.auth

import android.content.Context
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.convocados.wear.data.api.WearApiClient
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Handles Google Sign-In directly on the Wear OS device.
 * Uses Credential Manager + Google Identity Services to get an ID token,
 * then exchanges it with the Convocados backend for OAuth tokens.
 *
 * This is the primary login method — prominent and seamless on the watch.
 * The Data Layer sync from the phone app is a secondary/fallback path.
 */
@Singleton
class WearGoogleSignIn @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiClient: WearApiClient,
    private val tokenStore: WearTokenStore,
) {
    private val credentialManager = CredentialManager.create(context)

    /**
     * Build the credential request for Google Sign-In.
     * Uses the server client ID so the backend can verify the ID token.
     */
    fun buildCredentialRequest(): GetCredentialRequest {
        val googleIdOption = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(SERVER_CLIENT_ID)
            .setAutoSelectEnabled(true)
            .build()

        return GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()
    }

    /**
     * Process the credential response from Google Sign-In.
     * Extracts the ID token and exchanges it with the backend.
     */
    suspend fun handleSignInResult(result: GetCredentialResponse): Boolean {
        val credential = result.credential

        if (credential is CustomCredential &&
            credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
        ) {
            val googleIdToken = GoogleIdTokenCredential.createFrom(credential.data)
            val idToken = googleIdToken.idToken

            return try {
                val tokenResponse = apiClient.exchangeGoogleToken(idToken)
                tokenStore.setTokens(
                    OAuthTokens(
                        accessToken = tokenResponse.accessToken,
                        refreshToken = tokenResponse.refreshToken ?: "",
                        expiresAt = System.currentTimeMillis() + tokenResponse.expiresIn * 1000,
                    )
                )
                Log.d("WearGoogleSignIn", "Google Sign-In successful")
                true
            } catch (e: Exception) {
                Log.e("WearGoogleSignIn", "Token exchange failed", e)
                false
            }
        }

        Log.w("WearGoogleSignIn", "Unexpected credential type: ${credential.javaClass.name}")
        return false
    }

    companion object {
        // This should match the Google OAuth client ID configured in the backend.
        // In production, this would come from google-services.json or build config.
        const val SERVER_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
    }
}
