package dev.convocados.wear.data.auth

import android.content.Context
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
import dev.convocados.wear.data.api.OAuthTokenResponse
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "WearRestoreCredentials"
private const val PREFS_NAME = "convocados_wear_restore_credentials"
private const val CREATED_KEY = "restore_credential_created"

@Singleton
class WearRestoreCredentialCoordinator @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val tokenStore: WearTokenStore,
    private val gateway: WearRestoreCredentialGateway,
    private val credentialManager: CredentialManager,
) {
    private val operationMutex = Mutex()
    private val preferences = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    suspend fun restoreOrCreate(context: Context): Boolean = operationMutex.withLock {
        if (tokenStore.isAuthenticated.value) {
            return@withLock createIfNeededLocked(context)
        }
        restoreLocked(context)
    }

    suspend fun restoreIfNeeded(context: Context): Boolean = operationMutex.withLock {
        if (tokenStore.isAuthenticated.value) return@withLock false
        restoreLocked(context)
    }

    suspend fun ensureCreated(context: Context = appContext): Boolean = operationMutex.withLock {
        createIfNeededLocked(context)
    }

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
