package dev.convocados.data.auth

import android.content.Context
import android.os.Build
import android.util.Log
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CreateRestoreCredentialRequest
import androidx.credentials.CreateRestoreCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetRestoreCredentialOption
import androidx.credentials.RestoreCredential
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import androidx.credentials.exceptions.restorecredential.E2eeUnavailableException
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.convocados.data.api.OAuthTokenResponse
import dev.convocados.data.push.PushTokenManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "RestoreCredentials"
private const val PREFS_NAME = "convocados_restore_credentials"
private const val CREATED_KEY = "restore_credential_created"

/** Coordinates Restore Credential creation, restoration, and deletion for :app. */
@Singleton
class RestoreCredentialCoordinator @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val tokenStore: TokenStore,
    private val gateway: RestoreCredentialGateway,
    private val credentialManager: CredentialManager,
    private val pushTokenManager: PushTokenManager,
    private val wearAuthSync: WearAuthSync,
) {
    private val operationMutex = Mutex()
    private val preferences = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Restore on a new device, or create the key for an already-authenticated user. */
    suspend fun restoreOrCreate(context: Context): Boolean = operationMutex.withLock {
        if (tokenStore.isAuthenticated.value) {
            return@withLock createIfNeededLocked(context)
        }
        restoreLocked(context)
    }

    /** Retrieve a restore key and exchange it for the app's OAuth tokens. */
    suspend fun restoreIfNeeded(context: Context): Boolean = operationMutex.withLock {
        if (tokenStore.isAuthenticated.value) return@withLock false
        restoreLocked(context)
    }

    /** Create a restore key after any successful sign-in, if one is not recorded locally. */
    suspend fun ensureCreated(context: Context = appContext): Boolean = operationMutex.withLock {
        createIfNeededLocked(context)
    }

    /** Delete the system-managed restore key during explicit sign-out. */
    suspend fun clearCredentialState() {
        try {
            credentialManager.clearCredentialState(
                ClearCredentialStateRequest(ClearCredentialStateRequest.TYPE_CLEAR_RESTORE_CREDENTIAL),
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Unable to clear Restore Credential state", e)
        } finally {
            preferences.edit().remove(CREATED_KEY).apply()
        }
    }

    private suspend fun restoreLocked(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false
        return try {
            val authenticationJson = gateway.fetchAuthenticationOptions()
            val request = GetCredentialRequest(
                listOf(GetRestoreCredentialOption(authenticationJson)),
            )
            val response = credentialManager.getCredential(context, request)
            val credential = response.credential as? RestoreCredential
                ?: error("Credential Manager returned a non-restore credential")
            val tokenResponse = gateway.authenticate(credential.authenticationResponseJson)
            tokenStore.setTokens(tokenResponse.toOAuthTokens())
            preferences.edit().putBoolean(CREATED_KEY, true).apply()
            pushTokenManager.registerCurrentToken()
            wearAuthSync.syncTokens()
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: NoCredentialException) {
            Log.i(TAG, "No Restore Credential is available")
            false
        } catch (e: GetCredentialException) {
            Log.i(TAG, "Restore Credential retrieval failed: ${e.message}")
            false
        } catch (e: Exception) {
            Log.i(TAG, "Restore Credential unavailable: ${e.message}")
            false
        }
    }

    private suspend fun createIfNeededLocked(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false
        if (preferences.getBoolean(CREATED_KEY, false)) return true
        return try {
            val requestJson = gateway.fetchRegistrationOptions()
            val response = createCredentialWithFallback(context, requestJson)
            val restoreResponse = response as? CreateRestoreCredentialResponse
                ?: error("Credential Manager returned a non-restore creation response")
            gateway.register(restoreResponse.responseJson)
            preferences.edit().putBoolean(CREATED_KEY, true).apply()
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.i(TAG, "Restore Credential creation unavailable: ${e.message}")
            false
        }
    }

    private suspend fun createCredentialWithFallback(
        context: Context,
        requestJson: String,
    ) = try {
        credentialManager.createCredential(
            context,
            CreateRestoreCredentialRequest(requestJson, isCloudBackupEnabled = true),
        )
    } catch (e: E2eeUnavailableException) {
        credentialManager.createCredential(
            context,
            CreateRestoreCredentialRequest(requestJson, isCloudBackupEnabled = false),
        )
    }

    private fun OAuthTokenResponse.toOAuthTokens() = OAuthTokens(
        accessToken = accessToken,
        refreshToken = refreshToken ?: "",
        expiresAt = System.currentTimeMillis() + expiresIn * 1000,
    )
}
