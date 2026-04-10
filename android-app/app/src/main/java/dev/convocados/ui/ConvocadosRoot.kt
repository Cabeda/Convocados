package dev.convocados.ui

import android.content.Intent
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.UserProfile
import dev.convocados.data.auth.AuthManager
import dev.convocados.data.auth.TokenStore
import dev.convocados.data.push.PushTokenManager
import dev.convocados.ui.navigation.AppNavigation
import dev.convocados.ui.theme.ConvocadosTheme
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class RootViewModel @Inject constructor(
    val tokenStore: TokenStore,
    private val api: ConvocadosApi,
    val authManager: AuthManager,
    private val pushTokenManager: PushTokenManager,
) : ViewModel() {

    val isAuthenticated = tokenStore.isAuthenticated

    private val _user = MutableStateFlow<UserProfile?>(null)
    val user: StateFlow<UserProfile?> = _user

    init {
        viewModelScope.launch {
            isAuthenticated.collect { authed ->
                if (authed) {
                    runCatching { _user.value = api.fetchUserInfo() }
                    pushTokenManager.registerCurrentToken()
                } else {
                    _user.value = null
                }
            }
        }
    }

    fun handleIntent(intent: Intent) {
        val uri = intent.data ?: return
        if (uri.scheme == "convocados") {
            viewModelScope.launch {
                authManager.handleCallback(uri)
                runCatching { _user.value = api.fetchUserInfo() }
                pushTokenManager.registerCurrentToken()
            }
        }
    }

    fun logout() {
        pushTokenManager.unregisterCurrentToken()
        authManager.logout()
        _user.value = null
    }
}

@Composable
fun ConvocadosRoot(viewModel: RootViewModel = hiltViewModel()) {
    val isAuthenticated by viewModel.isAuthenticated.collectAsState()

    // Handle deep link intent
    val context = LocalContext.current
    LaunchedEffect(Unit) {
        val activity = context as? android.app.Activity
        activity?.intent?.let { viewModel.handleIntent(it) }
    }

    ConvocadosTheme {
        AppNavigation(isAuthenticated = isAuthenticated)
    }
}
