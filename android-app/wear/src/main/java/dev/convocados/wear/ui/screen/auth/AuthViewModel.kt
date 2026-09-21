package dev.convocados.wear.ui.screen.auth

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.auth.OAuthTokens
import dev.convocados.wear.data.auth.WearGoogleSignIn
import dev.convocados.wear.data.auth.WearGoogleSignInResult
import dev.convocados.wear.data.auth.WearRestoreCredentialCoordinator
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
    private val restoreCredentialCoordinator: WearRestoreCredentialCoordinator,
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
                val tokenResponse = apiClient.signInWithEmail(email, password)
                tokenStore.setTokens(
                    OAuthTokens(
                        accessToken = tokenResponse.accessToken,
                        refreshToken = tokenResponse.refreshToken ?: "",
                        expiresAt = System.currentTimeMillis() + tokenResponse.expiresIn * 1000,
                    )
                )
                restoreCredentialCoordinator.ensureCreated()
            } catch (e: Exception) {
                _uiState.update { it.copy(error = "Login failed: ${e.message}") }
            } finally {
                _uiState.update { it.copy(isSigningIn = false) }
            }
        }
    }

    /**
     * Interactive Sign in with Google. Credential Manager needs an Activity to
     * present its account sheet, so the screen supplies it.
     */
    fun signInWithGoogle(activity: Activity) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSigningIn = true, error = null) }
            val result = googleSignIn.signIn(activity)
            if (result is WearGoogleSignInResult.Success) {
                restoreCredentialCoordinator.ensureCreated()
            }
            _uiState.update {
                it.copy(
                    isSigningIn = false,
                    error = when (result) {
                        is WearGoogleSignInResult.Success -> null
                        // Dismissing the sheet is not a failure; stay quiet.
                        is WearGoogleSignInResult.Cancelled -> null
                        is WearGoogleSignInResult.NoCredential ->
                            "No Google account on this watch. Use email sign-in."
                        is WearGoogleSignInResult.Error -> "Sign-in failed. Try again."
                    },
                )
            }
        }
    }

    /**
     * Best-effort zero-tap sign-in for a watch already using this Google
     * account. Resolves silently; on failure the caller just shows the sign-in
     * affordance.
     */
    fun trySilentSignIn(activity: Activity) {
        if (isAuthenticated.value) return
        viewModelScope.launch {
            _uiState.update { it.copy(isSigningIn = true) }
            val success = googleSignIn.trySilentSignIn(activity)
            if (success) restoreCredentialCoordinator.ensureCreated()
            _uiState.update { it.copy(isSigningIn = false) }
        }
    }

    fun signOut() {
        tokenStore.clearTokens()
        viewModelScope.launch {
            googleSignIn.signOut()
            restoreCredentialCoordinator.clearCredentialState()
        }
    }

    fun getServerUrl() = tokenStore.getServerUrl()
    fun setServerUrl(url: String) = tokenStore.setServerUrl(url)
}
