package dev.convocados.wear.ui.screen.auth

import android.app.Application
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
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
)

@HiltViewModel
class AuthViewModel @Inject constructor(
    application: Application,
    private val tokenStore: WearTokenStore,
    private val googleSignIn: WearGoogleSignIn,
) : AndroidViewModel(application) {

    val isAuthenticated: StateFlow<Boolean> = tokenStore.isAuthenticated

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

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

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
