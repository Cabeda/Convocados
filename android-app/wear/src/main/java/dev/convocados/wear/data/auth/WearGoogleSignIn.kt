package dev.convocados.wear.data.auth

import android.app.Activity
import android.content.Context
import android.util.Log
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.convocados.wear.BuildConfig
import dev.convocados.wear.data.api.WearApiClient
import javax.inject.Inject
import javax.inject.Singleton

/** Outcome of an interactive Google sign-in attempt. */
sealed interface WearGoogleSignInResult {
    /** ID token exchanged for app tokens; the caller is now authenticated. */
    data object Success : WearGoogleSignInResult

    /** The user dismissed the Credential Manager sheet — not an error. */
    data object Cancelled : WearGoogleSignInResult

    /** No usable Google account on the watch. */
    data object NoCredential : WearGoogleSignInResult

    data class Error(val message: String?) : WearGoogleSignInResult
}

/**
 * Sign in with Google on Wear OS via Credential Manager.
 *
 * Standalone watches have no companion app to borrow a session from, and the
 * legacy GoogleSignIn/GoogleSignInClient API was removed in play-services-auth
 * 22.0.0. Credential Manager is Google's replacement and the documented Wear OS
 * path: it runs entirely on the watch, needing only a data connection.
 *
 * It requires Wear OS API 35+ (Credential Manager's Google and password
 * providers are not available below that), which is why :wear is minSdk 35. Its
 * `GetGoogleIdOption` returns an ID token — the same thing the previous
 * implementation produced — so the backend exchange is unchanged.
 *
 * Passkeys can't be *created* on Wear OS and the hybrid/restore flows aren't
 * supported there, so this is sign-in only.
 */
@Singleton
class WearGoogleSignIn @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiClient: WearApiClient,
    private val tokenStore: WearTokenStore,
) {
    private val credentialManager = CredentialManager.create(context)

    private fun webClientId(): String {
        val clientId = BuildConfig.GOOGLE_SERVER_CLIENT_ID
        require(clientId.isNotBlank()) {
            "GOOGLE_SERVER_CLIENT_ID is empty. Add it to android-app/local.properties"
        }
        return clientId
    }

    /**
     * Credential Manager request for sign-in.
     *
     * [filterByAuthorizedAccounts] = false lists every Google account on the
     * watch; true restricts to accounts that have already used the app, which is
     * what the zero-tap attempt wants.
     */
    private fun buildRequest(filterByAuthorizedAccounts: Boolean): GetCredentialRequest {
        val googleIdOption = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(filterByAuthorizedAccounts)
            .setServerClientId(webClientId())
            .setAutoSelectEnabled(filterByAuthorizedAccounts)
            .build()

        return GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()
    }

    /**
     * Interactive sign-in. Must be called with an Activity so Credential Manager
     * can present its account sheet on the watch.
     */
    suspend fun signIn(activity: Activity): WearGoogleSignInResult {
        return try {
            val response = credentialManager.getCredential(activity, buildRequest(false))
            if (exchangeFrom(response)) WearGoogleSignInResult.Success
            else WearGoogleSignInResult.Error("Could not exchange the Google token")
        } catch (e: GetCredentialCancellationException) {
            Log.d(TAG, "Sign-in cancelled: ${e.message}")
            WearGoogleSignInResult.Cancelled
        } catch (e: NoCredentialException) {
            Log.d(TAG, "No Google account on this watch: ${e.message}")
            WearGoogleSignInResult.NoCredential
        } catch (e: GetCredentialException) {
            Log.e(TAG, "Credential Manager failed", e)
            WearGoogleSignInResult.Error(e.message)
        } catch (e: Exception) {
            Log.e(TAG, "Unexpected sign-in failure", e)
            WearGoogleSignInResult.Error(e.message)
        }
    }

    /**
     * Best-effort zero-tap sign-in for a watch that has already used the app on
     * this Google account. Never surfaces an error: if it does not resolve
     * silently the caller shows the normal sign-in affordance.
     */
    suspend fun trySilentSignIn(activity: Activity): Boolean {
        return try {
            val response = credentialManager.getCredential(activity, buildRequest(true))
            exchangeFrom(response)
        } catch (e: Exception) {
            Log.d(TAG, "Silent sign-in unavailable: ${e.message}")
            false
        }
    }

    /** Pull the ID token out of the Credential Manager response and exchange it. */
    private suspend fun exchangeFrom(response: GetCredentialResponse): Boolean {
        val credential = response.credential
        if (credential !is CustomCredential) {
            Log.e(TAG, "Unexpected credential type: ${credential.type}")
            return false
        }
        if (credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            Log.e(TAG, "Unexpected custom credential type: ${credential.type}")
            return false
        }
        return try {
            val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
            exchange(idToken)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read the Google ID token", e)
            false
        }
    }

    /**
     * Drop Credential Manager's auto-select state for this app so a signed-out
     * user isn't silently re-authenticated.
     */
    suspend fun signOut() {
        try {
            credentialManager.clearCredentialState(ClearCredentialStateRequest())
        } catch (e: Exception) {
            Log.w(TAG, "Could not clear credential state: ${e.message}")
        }
    }

    private suspend fun exchange(idToken: String?): Boolean {
        if (idToken.isNullOrBlank()) {
            Log.e(TAG, "No ID token returned from Google")
            return false
        }
        return try {
            val tokenResponse = apiClient.exchangeGoogleToken(idToken)
            tokenStore.setTokens(
                OAuthTokens(
                    accessToken = tokenResponse.accessToken,
                    refreshToken = tokenResponse.refreshToken ?: "",
                    expiresAt = System.currentTimeMillis() + tokenResponse.expiresIn * 1000,
                )
            )
            Log.d(TAG, "Google Sign-In successful")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Token exchange failed", e)
            false
        }
    }

    suspend fun loginWithEmail(email: String, password: String): dev.convocados.wear.data.api.OAuthTokenResponse {
        return apiClient.loginWithEmail(email, password)
    }

    private companion object {
        const val TAG = "WearGoogleSignIn"
    }
}
