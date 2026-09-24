package dev.convocados.ui.screen.profile

import app.cash.turbine.test
import dev.convocados.data.api.ApiException
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.CredentialsResponse
import dev.convocados.data.api.LinkedCredential
import dev.convocados.data.api.OkResponse
import dev.convocados.data.api.PendingMergeResponse
import dev.convocados.data.api.PendingMergeView
import dev.convocados.data.api.UserProfile
import dev.convocados.data.auth.AuthManager
import dev.convocados.data.auth.LinkResult
import dev.convocados.data.auth.TokenStore
import dev.convocados.data.datastore.SettingsStore
import dev.convocados.data.push.PushTokenManager
import dev.convocados.data.repository.UserRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ProfileViewModelTest {
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val api = mockk<ConvocadosApi>(relaxed = true)
    private val authManager = mockk<AuthManager>(relaxed = true)
    private val tokenStore = mockk<TokenStore>(relaxed = true)
    private val settingsStore = mockk<SettingsStore>(relaxed = true)
    private val pushTokenManager = mockk<PushTokenManager>(relaxed = true)
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `viewModel observes user profile from repository`() = runTest {
        val profile = UserProfile("1", "User", "user@test.com", null)
        every { userRepository.userProfile } returns flowOf(profile)

        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)

        viewModel.user.test {
            val item = awaitItem()
            if (item == null) {
                assertEquals(profile, awaitItem())
            } else {
                assertEquals(profile, item)
            }
        }
    }

    @Test
    fun `logout calls clear user and auth logout`() = runTest {
        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)

        viewModel.logout()
        advanceUntilIdle()

        coVerify { pushTokenManager.unregisterCurrentToken() }
        coVerify { authManager.logout() }
        coVerify { userRepository.clearUser() }
    }

    @Test
    fun `setLocale updates settings store`() = runTest {
        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)

        viewModel.setLocale("pt")
        advanceUntilIdle()

        coVerify { settingsStore.setLocale("pt") }
    }

    @Test
    fun `updateName calls api and refreshes profile`() = runTest {
        coEvery { api.updateProfile("New Name") } returns UserProfile("1", "New Name", "test@test.com")

        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)
        advanceUntilIdle()

        viewModel.updateName("New Name")
        advanceUntilIdle()

        coVerify { api.updateProfile("New Name") }
        coVerify(atLeast = 2) { userRepository.refreshUserProfile() }
    }

    @Test
    fun `updateProfilePhoto delegates to the repository`() = runTest {
        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)

        viewModel.updateProfilePhoto("data:image/jpeg;base64,AAAA")
        advanceUntilIdle()

        coVerify { userRepository.uploadProfilePhoto("data:image/jpeg;base64,AAAA") }
    }

    @Test
    fun `removeProfilePhoto delegates to the repository`() = runTest {
        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)

        viewModel.removeProfilePhoto()
        advanceUntilIdle()

        coVerify { userRepository.removeProfilePhoto() }
    }

    // ── Linked sign-in methods (ADR 0040) ─────────────────────────────────

    private fun pendingMerge() = PendingMergeView(
        absorbedUserId = "absorbed-user",
        absorbedEmail = "absorbed@example.com",
        absorbedName = "Absorbed",
        absorbedCreatedAt = "2026-01-01T00:00:00.000Z",
        absorbedEventCount = 3,
        providerId = "google",
        accountId = "owned-sub",
    )

    private fun credentials(
        vararg providers: String,
    ) = CredentialsResponse(
        providers.mapIndexed { i, p ->
            LinkedCredential(id = "c$i", providerId = p, accountId = "acc$i", issuer = null, createdAt = "2026-01-0${i + 1}T00:00:00.000Z")
        },
    )

    @Test
    fun `refreshCredentials loads credentials from api`() = runTest {
        coEvery { api.fetchCredentials() } returns credentials("credential")
        coEvery { api.fetchPendingMerge() } returns PendingMergeResponse(null)

        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)
        viewModel.refreshCredentials()
        advanceUntilIdle()

        val state = viewModel.credentialsUi.value
        assertEquals(false, state.loading)
        assertEquals(1, state.credentials.size)
        assertEquals("credential", state.credentials[0].providerId)
        assertEquals(null, state.error)
        assertEquals(false, state.mergeDialogOpen)
    }

    @Test
    fun `refreshCredentials opens the merge dialog when a merge is pending`() = runTest {
        coEvery { api.fetchCredentials() } returns credentials("credential")
        coEvery { api.fetchPendingMerge() } returns PendingMergeResponse(pendingMerge())

        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)
        viewModel.refreshCredentials()
        advanceUntilIdle()

        val state = viewModel.credentialsUi.value
        assertEquals(true, state.mergeDialogOpen)
        assertEquals("absorbed@example.com", state.pendingMerge?.absorbedEmail)
    }

    @Test
    fun `refreshCredentials surfaces a load error`() = runTest {
        coEvery { api.fetchCredentials() } throws ApiException(500, "boom")

        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)
        viewModel.refreshCredentials()
        advanceUntilIdle()

        val state = viewModel.credentialsUi.value
        assertEquals(false, state.loading)
        assertEquals("credential_load_error", state.error)
    }

    @Test
    fun `unlinkCredential calls api and reloads`() = runTest {
        coEvery { api.fetchCredentials() } returns credentials("credential", "google")
        coEvery { api.fetchPendingMerge() } returns PendingMergeResponse(null)
        coEvery { api.unlinkCredential("c0") } returns OkResponse(true)

        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)
        viewModel.unlinkCredential("c0")
        advanceUntilIdle()

        coVerify { api.unlinkCredential("c0") }
        val state = viewModel.credentialsUi.value
        assertEquals("credential_unlinked", state.message)
        assertEquals(null, state.error)
        // Reloaded after unlink
        coVerify(atLeast = 1) { api.fetchCredentials() }
    }

    @Test
    fun `unlinkCredential surfaces the sole-credential server error`() = runTest {
        coEvery { api.unlinkCredential("c0") } throws ApiException(
            403,
            "Cannot remove your only sign-in method — keep at least one credential.",
        )

        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)
        viewModel.unlinkCredential("c0")
        advanceUntilIdle()

        val state = viewModel.credentialsUi.value
        assertEquals(
            "Cannot remove your only sign-in method — keep at least one credential.",
            state.error,
        )
        assertEquals(null, state.message)
    }

    @Test
    fun `linkGoogle success records a message and reloads`() = runTest {
        coEvery { authManager.linkGoogleCredential("id-token") } returns LinkResult.Success
        coEvery { api.fetchCredentials() } returns credentials("credential", "google")
        coEvery { api.fetchPendingMerge() } returns PendingMergeResponse(null)

        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)
        viewModel.linkGoogle("id-token")
        advanceUntilIdle()

        coVerify { authManager.linkGoogleCredential("id-token") }
        val state = viewModel.credentialsUi.value
        assertEquals("link_google_success", state.message)
        assertEquals(false, state.linking)
        // Reload shows the newly linked Google credential
        assertEquals(2, state.credentials.size)
    }

    @Test
    fun `linkGoogle conflict reloads into the merge dialog without an error`() = runTest {
        coEvery { authManager.linkGoogleCredential("id-token") } returns LinkResult.Conflict
        coEvery { api.fetchCredentials() } returns credentials("credential")
        coEvery { api.fetchPendingMerge() } returns PendingMergeResponse(pendingMerge())

        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)
        viewModel.linkGoogle("id-token")
        advanceUntilIdle()

        val state = viewModel.credentialsUi.value
        assertEquals(null, state.error)
        assertEquals(null, state.message)
        assertEquals(true, state.mergeDialogOpen)
        assertEquals(false, state.linking)
    }

    @Test
    fun `linkGoogle failure surfaces an error`() = runTest {
        coEvery { authManager.linkGoogleCredential("id-token") } returns LinkResult.Error("nope")

        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)
        viewModel.linkGoogle("id-token")
        advanceUntilIdle()

        val state = viewModel.credentialsUi.value
        assertEquals("link_google_error", state.error)
        assertEquals(false, state.linking)
    }

    @Test
    fun `confirmMerge calls api, clears the pending merge and records a message`() = runTest {
        coEvery { api.fetchCredentials() } returns credentials("credential")
        coEvery { api.fetchPendingMerge() } returns PendingMergeResponse(pendingMerge()) andThen PendingMergeResponse(null)
        coEvery { api.confirmMerge() } returns OkResponse(true)

        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)
        viewModel.refreshCredentials()
        advanceUntilIdle()
        assertEquals(true, viewModel.credentialsUi.value.mergeDialogOpen)

        viewModel.confirmMerge()
        advanceUntilIdle()

        coVerify { api.confirmMerge() }
        val state = viewModel.credentialsUi.value
        assertEquals("merge_success", state.message)
        assertEquals(null, state.pendingMerge)
        assertEquals(false, state.mergeDialogOpen)
    }

    @Test
    fun `dismissMerge closes the dialog without losing credentials`() = runTest {
        coEvery { api.fetchCredentials() } returns credentials("credential")
        coEvery { api.fetchPendingMerge() } returns PendingMergeResponse(pendingMerge())

        val viewModel = ProfileViewModel(userRepository, api, authManager, tokenStore, settingsStore, pushTokenManager)
        viewModel.refreshCredentials()
        advanceUntilIdle()

        viewModel.dismissMerge()
        advanceUntilIdle()

        assertEquals(false, viewModel.credentialsUi.value.mergeDialogOpen)
        assertEquals(1, viewModel.credentialsUi.value.credentials.size)
    }
}
