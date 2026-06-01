package dev.convocados.wear.ui.screen.auth

import android.content.Intent
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

    init {
        // Zero-tap login on watches that already have a Google account.
        trySilentSignIn()
    }

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
                val tokenResponse = apiClient.signInWithEmail(email, password)
                tokenStore.setTokens(
                    OAuthTokens(
                        accessToken = tokenResponse.accessToken,
                        refreshToken = tokenResponse.refreshToken ?: "",
                        expiresAt = System.currentTimeMillis() + tokenResponse.expiresIn * 1000,
                    )
                )
            } catch (e: Exception) {
                _uiState.update { it.copy(error = "Login failed: ${e.message}") }
            } finally {
                _uiState.update { it.copy(isSigningIn = false) }
            }
        }
    }

    /** Returns the intent that launches the on-device Google account picker. */
    fun getSignInIntent(): Intent = googleSignIn.getSignInIntent()

    /** Try a zero-tap silent sign-in using the existing on-device Google account. */
    fun trySilentSignIn() {
        if (isAuthenticated.value) return
        viewModelScope.launch {
            _uiState.update { it.copy(isSigningIn = true) }
            val success = googleSignIn.trySilentSignIn()
            _uiState.update { it.copy(isSigningIn = false) }
        }
    }

    /** Called with the result Intent from the interactive sign-in flow. */
    fun handleGoogleSignInResult(data: Intent?) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSigningIn = true, error = null) }
            val success = googleSignIn.handleSignInResult(data)
            _uiState.update {
                it.copy(
                    isSigningIn = false,
                    error = if (success) null else "Sign-in failed. Try again.",
                )
            }
        }
    }

    fun signOut() {
        tokenStore.clearTokens()
    }

    fun getServerUrl() = tokenStore.getServerUrl()
    fun setServerUrl(url: String) = tokenStore.setServerUrl(url)
}
