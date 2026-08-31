package dev.convocados.data.auth

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CreateCredentialRequest
import androidx.credentials.CreateRestoreCredentialRequest
import androidx.credentials.CreateRestoreCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetRestoreCredentialOption
import androidx.credentials.RestoreCredential
import androidx.credentials.exceptions.restorecredential.E2eeUnavailableException
import dev.convocados.data.api.OAuthTokenResponse
import dev.convocados.data.push.PushTokenManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RestoreCredentialCoordinatorTest {
    private val context = mockk<Context>(relaxed = true)
    private val preferences = mockk<SharedPreferences>(relaxed = true)
    private val editor = mockk<SharedPreferences.Editor>(relaxed = true)
    private val tokenStore = mockk<TokenStore>(relaxed = true)
    private val gateway = mockk<RestoreCredentialGateway>(relaxed = true)
    private val credentialManager = mockk<CredentialManager>()
    private val pushTokenManager = mockk<PushTokenManager>(relaxed = true)
    private val wearAuthSync = mockk<WearAuthSync>(relaxed = true)
    private val authenticated = MutableStateFlow(false)

    @Before
    fun setUp() {
        every { context.getSharedPreferences(any(), any()) } returns preferences
        every { preferences.edit() } returns editor
        every { editor.putBoolean(any(), any()) } returns editor
        every { editor.remove(any()) } returns editor
        every { tokenStore.isAuthenticated } returns authenticated
    }

    private fun coordinator() = RestoreCredentialCoordinator(
        appContext = context,
        tokenStore = tokenStore,
        gateway = gateway,
        credentialManager = credentialManager,
        pushTokenManager = pushTokenManager,
        wearAuthSync = wearAuthSync,
    )

    @Test
    fun `restore requests only a restore credential and stores returned tokens`() = runTest {
        val restoreCredential = mockk<RestoreCredential> {
            every { authenticationResponseJson } returns "{\"id\":\"restore-key\"}"
        }
        every { preferences.getBoolean(any(), false) } returns false
        coEvery { gateway.fetchAuthenticationOptions() } returns "{\"challenge\":\"challenge\"}"
        coEvery { gateway.authenticate("{\"id\":\"restore-key\"}") } returns OAuthTokenResponse(
            accessToken = "access",
            refreshToken = "refresh",
            expiresIn = 3600,
        )

        val requestSlot = io.mockk.slot<GetCredentialRequest>()
        coEvery { credentialManager.getCredential(any(), capture(requestSlot)) } returns GetCredentialResponse(restoreCredential)

        val restored = coordinator().restoreIfNeeded(context)

        assertTrue(restored)
        assertEquals(1, requestSlot.captured.credentialOptions.size)
        assertTrue(requestSlot.captured.credentialOptions.single() is GetRestoreCredentialOption)
        coVerify { tokenStore.setTokens(match { it.accessToken == "access" && it.refreshToken == "refresh" }) }
        coVerify { pushTokenManager.registerCurrentToken() }
        coVerify { wearAuthSync.syncTokens() }
    }

    @Test
    fun `create retries without cloud backup when E2EE is unavailable`() = runTest {
        every { preferences.getBoolean(any(), false) } returns false
        coEvery { gateway.fetchRegistrationOptions() } returns "{\"rp\":{\"name\":\"Convocados\"},\"user\":{\"id\":\"dXNlcg\",\"name\":\"test\",\"displayName\":\"Test\"},\"challenge\":\"Y2hhbGxlbmdl\",\"pubKeyCredParams\":[{\"type\":\"public-key\",\"alg\":-7}]}"
        val requests = mutableListOf<CreateRestoreCredentialRequest>()
        coEvery { credentialManager.createCredential(any(), any<CreateCredentialRequest>()) } coAnswers {
            val request = secondArg<CreateRestoreCredentialRequest>()
            requests += request
            if (request.isCloudBackupEnabled) {
                throw E2eeUnavailableException("E2EE is unavailable")
            }
            CreateRestoreCredentialResponse("{\"id\":\"restore-key\"}")
        }

        assertTrue(Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
        assertFalse(preferences.getBoolean("restore_credential_created", false))
        val created = coordinator().ensureCreated(context)

        assertTrue("created=$created requests=${requests.map { it.isCloudBackupEnabled }}", created)
        assertEquals(listOf(true, false), requests.map { it.isCloudBackupEnabled })
        coVerify { gateway.register("{\"id\":\"restore-key\"}") }
        coVerify { editor.putBoolean("restore_credential_created", true) }
    }

    @Test
    fun `clear removes the restore credential type and local creation marker`() = runTest {
        every { preferences.getBoolean("restore_credential_created", false) } returns true
        coEvery { credentialManager.clearCredentialState(any()) } returns Unit

        coordinator().clearCredentialState()

        val request = io.mockk.slot<ClearCredentialStateRequest>()
        coVerify { credentialManager.clearCredentialState(capture(request)) }
        assertEquals(ClearCredentialStateRequest.TYPE_CLEAR_RESTORE_CREDENTIAL, request.captured.requestType)
        coVerify { editor.remove("restore_credential_created") }
        assertFalse(authenticated.value)
    }
}
