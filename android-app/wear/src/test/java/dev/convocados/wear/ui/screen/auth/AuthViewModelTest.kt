package dev.convocados.wear.ui.screen.auth

import dev.convocados.wear.data.api.OAuthTokenResponse
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.auth.OAuthTokens
import dev.convocados.wear.data.auth.WearGoogleSignIn
import dev.convocados.wear.data.auth.WearTokenStore
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AuthViewModelTest {

    private val tokenStore = mockk<WearTokenStore>(relaxed = true)
    private val googleSignIn = mockk<WearGoogleSignIn>(relaxed = true)
    private val apiClient = mockk<WearApiClient>(relaxed = true)
    private val testDispatcher = StandardTestDispatcher()

    private lateinit var viewModel: AuthViewModel

    private val isAuthenticatedFlow = MutableStateFlow(false)

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        every { tokenStore.isAuthenticated } returns isAuthenticatedFlow
        every { tokenStore.getServerUrl() } returns "https://convocados.fly.dev"
        viewModel = AuthViewModel(tokenStore, googleSignIn, apiClient)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `initial state has empty email and password`() {
        val state = viewModel.uiState.value
        assertEquals("", state.email)
        assertEquals("", state.password)
        assertFalse(state.showEmailLogin)
        assertFalse(state.isSigningIn)
        assertNull(state.error)
    }

    @Test
    fun `onEmailChanged updates email in state`() {
        viewModel.onEmailChanged("test@example.com")
        assertEquals("test@example.com", viewModel.uiState.value.email)
    }

    @Test
    fun `onPasswordChanged updates password in state`() {
        viewModel.onPasswordChanged("secret123")
        assertEquals("secret123", viewModel.uiState.value.password)
    }

    @Test
    fun `toggleEmailLogin switches to email login mode`() {
        viewModel.toggleEmailLogin()
        assertTrue(viewModel.uiState.value.showEmailLogin)
    }

    @Test
    fun `toggleEmailLogin toggles back to Google login`() {
        viewModel.toggleEmailLogin()
        assertTrue(viewModel.uiState.value.showEmailLogin)
        viewModel.toggleEmailLogin()
        assertFalse(viewModel.uiState.value.showEmailLogin)
    }

    @Test
    fun `toggleEmailLogin clears error`() {
        viewModel.toggleEmailLogin()
        viewModel.toggleEmailLogin()
        assertNull(viewModel.uiState.value.error)
    }

    @Test
    fun `loginWithEmail shows error when email is blank`() {
        viewModel.onEmailChanged("")
        viewModel.onPasswordChanged("password")
        viewModel.loginWithEmail()
        assertEquals("Please enter email and password", viewModel.uiState.value.error)
    }

    @Test
    fun `loginWithEmail shows error when password is blank`() {
        viewModel.onEmailChanged("test@example.com")
        viewModel.onPasswordChanged("")
        viewModel.loginWithEmail()
        assertEquals("Please enter email and password", viewModel.uiState.value.error)
    }

    @Test
    fun `loginWithEmail calls apiClient signInWithEmail and stores tokens`() = runTest {
        val tokenResponse = OAuthTokenResponse(
            accessToken = "access123",
            refreshToken = "refresh456",
            expiresIn = 3600,
        )
        coEvery { apiClient.signInWithEmail("test@example.com", "password123") } returns tokenResponse

        viewModel.onEmailChanged("test@example.com")
        viewModel.onPasswordChanged("password123")
        viewModel.loginWithEmail()
        advanceUntilIdle()

        val slot = slot<OAuthTokens>()
        verify { tokenStore.setTokens(capture(slot)) }
        assertEquals("access123", slot.captured.accessToken)
        assertEquals("refresh456", slot.captured.refreshToken)
    }

    @Test
    fun `loginWithEmail shows error on failure`() = runTest {
        coEvery { apiClient.signInWithEmail(any(), any()) } throws Exception("Network error")

        viewModel.onEmailChanged("test@example.com")
        viewModel.onPasswordChanged("password123")
        viewModel.loginWithEmail()
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.error?.contains("Login failed") == true)
        assertFalse(viewModel.uiState.value.isSigningIn)
    }

    @Test
    fun `loginWithEmail sets isSigningIn during request`() = runTest {
        coEvery { apiClient.signInWithEmail(any(), any()) } coAnswers {
            assertTrue(viewModel.uiState.value.isSigningIn)
            OAuthTokenResponse("a", "r", 3600)
        }

        viewModel.onEmailChanged("test@example.com")
        viewModel.onPasswordChanged("password123")
        viewModel.loginWithEmail()
        advanceUntilIdle()
    }

    @Test
    fun `signOut clears tokens`() {
        viewModel.signOut()
        verify { tokenStore.clearTokens() }
    }
}