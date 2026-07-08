package dev.convocados.data.auth

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.convocados.data.api.ApiClient
import dev.convocados.data.api.OAuthTokenResponse
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.okhttp.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "AuthManager"

// ponytail: response for actions that don't return tokens (signup, magic-link)
@Serializable
data class MobileAuthMessage(
    val success: Boolean = false,
    val message: String = "",
    @Suppress("PropertyName") val requires_verification: Boolean = false,
    val error: String? = null,
)

/** Result of a native auth attempt. */
sealed interface AuthResult {
    data class Success(val tokens: OAuthTokens) : AuthResult
    data class NeedsVerification(val message: String) : AuthResult
    data class MagicLinkSent(val message: String) : AuthResult
    data class Error(val message: String) : AuthResult
    data object Cancelled : AuthResult
}

@Singleton
class AuthManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val tokenStore: TokenStore,
    private val wearAuthSync: WearAuthSync,
) {
    private val scope = CoroutineScope(Dispatchers.IO)
    private val credentialManager = CredentialManager.create(context)

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    private val httpClient = HttpClient(OkHttp) {
        install(ContentNegotiation) { json(this@AuthManager.json) }
    }

    private val baseUrl: String get() = tokenStore.getServerUrl()

    // ── Google Sign-In via Credential Manager ────────────────────────────────

    /** Build the Credential Manager request for Google Sign-In. */
    fun buildGoogleSignInRequest(): GetCredentialRequest {
        val clientId = getWebClientId()
        require(clientId.isNotBlank()) {
            "Google Sign-In not configured: default_web_client_id is missing. " +
                "Ensure google-services.json is present."
        }

        val googleIdOption = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(clientId)
            .setAutoSelectEnabled(true)
            .build()

        return GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()
    }

    /** Process the Credential Manager response and exchange for app tokens. */
    suspend fun handleGoogleCredential(response: GetCredentialResponse): AuthResult {
        return try {
            val credential = response.credential
            val googleIdTokenCredential = GoogleIdTokenCredential.createFrom(credential.data)
            val idToken = googleIdTokenCredential.idToken

            val tokenResponse = exchangeGoogleIdToken(idToken)
            storeTokens(tokenResponse)
            AuthResult.Success(tokenStore.getTokens()!!)
        } catch (e: Exception) {
            Log.e(TAG, "Google credential handling failed", e)
            AuthResult.Error(e.message ?: "Google sign-in failed")
        }
    }

    /** Handle Credential Manager errors. */
    fun handleCredentialError(e: GetCredentialException): AuthResult {
        return when (e) {
            is GetCredentialCancellationException -> AuthResult.Cancelled
            is NoCredentialException -> AuthResult.Error("No Google accounts available on this device")
            else -> {
                Log.e(TAG, "Credential Manager error", e)
                AuthResult.Error(e.message ?: "Authentication failed")
            }
        }
    }

    // ── Email/Password Sign-In ───────────────────────────────────────────────

    suspend fun signInWithEmail(email: String, password: String): AuthResult {
        return try {
            val response = httpClient.post("$baseUrl/api/auth/mobile-native") {
                contentType(ContentType.Application.Json)
                setBody(mapOf("action" to "email-signin", "email" to email, "password" to password))
            }
            if (!response.status.isSuccess()) {
                val err = runCatching { response.body<MobileAuthMessage>() }.getOrNull()
                return AuthResult.Error(err?.error ?: err?.message ?: "Invalid email or password")
            }
            val tokenResponse: OAuthTokenResponse = response.body()
            storeTokens(tokenResponse)
            AuthResult.Success(tokenStore.getTokens()!!)
        } catch (e: Exception) {
            Log.e(TAG, "Email sign-in failed", e)
            AuthResult.Error(e.message ?: "Sign-in failed")
        }
    }

    // ── Email/Password Sign-Up ───────────────────────────────────────────────

    suspend fun signUpWithEmail(name: String, email: String, password: String): AuthResult {
        return try {
            val response = httpClient.post("$baseUrl/api/auth/mobile-native") {
                contentType(ContentType.Application.Json)
                setBody(mapOf("action" to "email-signup", "name" to name, "email" to email, "password" to password))
            }
            if (response.status.value == 201) {
                val msg: MobileAuthMessage = response.body()
                return AuthResult.NeedsVerification(msg.message)
            }
            if (!response.status.isSuccess()) {
                val err = runCatching { response.body<MobileAuthMessage>() }.getOrNull()
                return AuthResult.Error(err?.error ?: err?.message ?: "Sign-up failed")
            }
            // Shouldn't reach here (signup always returns 201), but handle gracefully
            AuthResult.NeedsVerification("Account created. Check your email to verify.")
        } catch (e: Exception) {
            Log.e(TAG, "Email sign-up failed", e)
            AuthResult.Error(e.message ?: "Sign-up failed")
        }
    }

    // ── Magic Link ───────────────────────────────────────────────────────────

    suspend fun sendMagicLink(email: String): AuthResult {
        return try {
            val response = httpClient.post("$baseUrl/api/auth/mobile-native") {
                contentType(ContentType.Application.Json)
                setBody(mapOf("action" to "magic-link", "email" to email))
            }
            if (!response.status.isSuccess()) {
                val err = runCatching { response.body<MobileAuthMessage>() }.getOrNull()
                return AuthResult.Error(err?.error ?: "Could not send magic link")
            }
            val msg: MobileAuthMessage = response.body()
            AuthResult.MagicLinkSent(msg.message)
        } catch (e: Exception) {
            Log.e(TAG, "Magic link request failed", e)
            AuthResult.Error(e.message ?: "Could not send magic link")
        }
    }

    // ── Deep Link Callback (magic link returns via existing mobile-callback) ─

    suspend fun handleCallback(uri: Uri): Boolean {
        val code = uri.getQueryParameter("code") ?: return false
        return try {
            val response = httpClient.post("$baseUrl/api/auth/mobile-callback") {
                contentType(ContentType.Application.Json)
                setBody(mapOf("code" to code))
            }
            if (!response.status.isSuccess()) return false
            val tokenResponse: OAuthTokenResponse = response.body()
            storeTokens(tokenResponse)
            true
        } catch (e: Exception) {
            Log.e(TAG, "Callback handling failed", e)
            false
        }
    }

    // ── Logout ───────────────────────────────────────────────────────────────

    fun logout() {
        tokenStore.clearTokens()
        scope.launch { wearAuthSync.clearTokens() }
    }

    // ── Private Helpers ──────────────────────────────────────────────────────

    private suspend fun exchangeGoogleIdToken(idToken: String): OAuthTokenResponse {
        val response = httpClient.post("$baseUrl/api/auth/mobile-native") {
            contentType(ContentType.Application.Json)
            setBody(mapOf("action" to "google-id-token", "idToken" to idToken))
        }
        if (!response.status.isSuccess()) {
            val errBody = runCatching { response.body<MobileAuthMessage>() }.getOrNull()
            val msg = errBody?.error ?: errBody?.message ?: "Google token exchange failed (${response.status})"
            Log.e(TAG, "Token exchange failed: status=${response.status}, error=$msg")
            throw Exception(msg)
        }
        return response.body()
    }

    private fun storeTokens(tokenResponse: OAuthTokenResponse) {
        tokenStore.setTokens(
            OAuthTokens(
                accessToken = tokenResponse.accessToken,
                refreshToken = tokenResponse.refreshToken ?: "",
                expiresAt = System.currentTimeMillis() + tokenResponse.expiresIn * 1000,
            )
        )
        scope.launch { wearAuthSync.syncTokens() }
    }

    private fun getWebClientId(): String {
        // ponytail: uses the web client ID (not android client ID) for Credential Manager.
        // The web client ID is what Google's ID token `aud` field will contain.
        // Set via BuildConfig or fall back to env-injected string resource.
        return try {
            context.getString(context.resources.getIdentifier("default_web_client_id", "string", context.packageName))
        } catch (_: Exception) {
            // Fallback — should be set in google-services.json
            ""
        }
    }
}
