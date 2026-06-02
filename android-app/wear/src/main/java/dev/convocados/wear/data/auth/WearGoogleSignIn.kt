package dev.convocados.wear.data.auth

import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.tasks.Task
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.convocados.wear.BuildConfig
import dev.convocados.wear.data.api.WearApiClient
import kotlinx.coroutines.suspendCancellableCoroutine
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Standalone Google Sign-In on Wear OS using the legacy Google Sign-In API
 * (GoogleSignInClient).
 *
 * Credential Manager's Google provider is NOT supported on Wear OS
 * ("Google Identity Services do not support this Android Credential Manager
 * API on Wear OS"), so we use this GMS API instead. It reads the Google
 * account already configured on the device, so it works on standalone / LTE
 * watches with no paired phone.
 *
 * requestIdToken uses the server (web) client ID — which must match the
 * GOOGLE_CLIENT_ID env var on the backend — so better-auth can verify the
 * ID token via /api/auth/sign-in/social.
 */
@Singleton
class WearGoogleSignIn @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiClient: WearApiClient,
    private val tokenStore: WearTokenStore,
) {
    fun getClient(): GoogleSignInClient {
        val clientId = BuildConfig.GOOGLE_SERVER_CLIENT_ID
        require(clientId.isNotBlank()) {
            "GOOGLE_SERVER_CLIENT_ID is empty. Add it to android-app/local.properties"
        }
        val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(clientId)
            .requestEmail()
            .build()
        return GoogleSignIn.getClient(context, gso)
    }

    /** Intent that launches the on-device account picker (interactive). */
    fun getSignInIntent(): Intent = getClient().signInIntent

    /** Silently sign in using the existing on-device Google account (no UI). */
    suspend fun trySilentSignIn(): Boolean = try {
        val account = getClient().silentSignIn().await()
        exchange(account.idToken)
    } catch (e: Exception) {
        Log.d("WearGoogleSignIn", "Silent sign-in unavailable: ${e.message}")
        false
    }

    /** Handle the result Intent returned from the interactive sign-in flow. */
    suspend fun handleSignInResult(data: Intent?): Boolean = try {
        val account = GoogleSignIn.getSignedInAccountFromIntent(data).await()
        exchange(account.idToken)
    } catch (e: Exception) {
        Log.e("WearGoogleSignIn", "Sign-in failed", e)
        false
    }

    private suspend fun exchange(idToken: String?): Boolean {
        if (idToken.isNullOrBlank()) {
            Log.e("WearGoogleSignIn", "No ID token returned from Google")
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
            Log.d("WearGoogleSignIn", "Google Sign-In successful")
            true
        } catch (e: Exception) {
            Log.e("WearGoogleSignIn", "Token exchange failed", e)
            false
        }
    }

    suspend fun loginWithEmail(email: String, password: String): dev.convocados.wear.data.api.OAuthTokenResponse {
        return apiClient.loginWithEmail(email, password)
    }
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { cont.resume(it) }
    addOnFailureListener { cont.resumeWithException(it) }
    addOnCanceledListener { cont.cancel() }
}
