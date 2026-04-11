package dev.convocados.ui.screen.profile

import app.cash.turbine.test
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.UserProfile
import dev.convocados.data.auth.AuthManager
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
            assertEquals(profile, awaitItem())
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
}
