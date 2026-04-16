package dev.convocados.wear.ui.screen.auth

import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.auth.OAuthTokens
import dev.convocados.wear.data.auth.WearGoogleSignIn
import dev.convocados.wear.data.auth.WearTokenStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AuthUiState(
    val isSigningIn: Boolean = false,
    val error: String? = null,
    val showEmailLogin: Boolean = false,
    val email: String = "",
    val password: String = "",
)

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val tokenStore: WearTokenStore,
    private val googleSignIn: WearGoogleSignIn,
    private val apiClient: WearApiClient,
) : ViewModel() {

    val isAuthenticated: StateFlow<Boolean> = tokenStore.isAuthenticated

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    fun onEmailChanged(email: String) {
        _uiState.update { it.copy(email = email) }
    }

    fun onPasswordChanged(password: String) {
        _uiState.update { it.copy(password = password) }
    }

    fun toggleEmailLogin() {
        _uiState.update { it.copy(showEmailLogin = !it.showEmailLogin, error = null) }
    }

    fun loginWithEmail() {
        val email = uiState.value.email
        val password = uiState.value.password
        if (email.isBlank() || password.isBlank()) {
            _uiState.update { it.copy(error = "Please enter email and password") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isSigningIn = true, error = null) }
            try {
                val response = googleSignIn.loginWithEmail(email, password)
                tokenStore.setTokens(
                    dev.convocados.wear.data.auth.OAuthTokens(
                        accessToken = response.accessToken,
                        refreshToken = response.refreshToken ?: "",
                        expiresAt = System.currentTimeMillis() + response.expiresIn * 1000
                    )
                )
            } catch (e: Exception) {
                _uiState.update { it.copy(error = "Login failed: ${e.message}") }
            } finally {
                _uiState.update { it.copy(isSigningIn = false) }
            }
        }
    }

    /** Returns the credential request to launch from the Activity. */
    fun getGoogleSignInRequest(): GetCredentialRequest = googleSignIn.buildCredentialRequest()

    /** Called after the Activity receives the credential response. */
    fun handleGoogleSignInResult(result: androidx.credentials.GetCredentialResponse) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSigningIn = true, error = null) }
            val success = googleSignIn.handleSignInResult(result)
            _uiState.update {
                it.copy(
                    isSigningIn = false,
                    error = if (success) null else "Sign-in failed. Try again.",
                )
            }
        }
    }

    fun handleGoogleSignInError(e: Exception) {
        val message = when (e) {
            is GetCredentialCancellationException -> null // User cancelled, no error
            is NoCredentialException -> "No Google account found"
            else -> "Sign-in failed: ${e.message}"
        }
        _uiState.update { it.copy(isSigningIn = false, error = message) }
    }

    fun signOut() {
        tokenStore.clearTokens()
    }

    fun getServerUrl() = tokenStore.getServerUrl()
    fun setServerUrl(url: String) = tokenStore.setServerUrl(url)

    /**
     * Sign in with email/password via the mobile-callback OAuth flow.
     * Uses the same flow as the phone app to get real tokens.
     * For local dev: email=test@example.com, password=TestPassword123
     */
    fun signInWithEmail(email: String, password: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSigningIn = true, error = null) }
            try {
                val tokenResponse = apiClient.signInWithEmail(email, password)
                tokenStore.setTokens(
                    OAuthTokens(
                        accessToken = tokenResponse.accessToken,
                        refreshToken = tokenResponse.refreshToken ?: "",
                        expiresAt = System.currentTimeMillis() + tokenResponse.expiresIn * 1000,
                    )
                )
                _uiState.update { it.copy(isSigningIn = false, error = null) }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isSigningIn = false, error = "Sign-in failed: ${e.message}")
                }
            }
        }
    }
}
