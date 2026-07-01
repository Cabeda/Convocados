package dev.convocados.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkManager
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.UserProfile
import dev.convocados.data.auth.AuthManager
import dev.convocados.data.auth.TokenRefreshWorker
import dev.convocados.data.auth.TokenStore
import dev.convocados.data.datastore.SettingsStore
import dev.convocados.data.push.PushTokenManager
import dev.convocados.ui.navigation.AppNavigation
import dev.convocados.ui.theme.ConvocadosTheme
import dev.convocados.ui.theme.ThemeMode
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class RootViewModel @Inject constructor(
    val tokenStore: TokenStore,
    private val api: ConvocadosApi,
    val authManager: AuthManager,
    private val pushTokenManager: PushTokenManager,
    private val workManager: WorkManager,
    private val settingsStore: SettingsStore,
) : ViewModel() {

    val isAuthenticated = tokenStore.isAuthenticated
    val themeMode = settingsStore.themeMode
    val dynamicColor = settingsStore.dynamicColor

    // ADR 0018: Prevents navigation to Login during OAuth callback processing
    private val _processingAuth = MutableStateFlow(false)
    val processingAuth: StateFlow<Boolean> = _processingAuth

    // Blocks initial navigation until we've confirmed auth state (silent refresh if needed)
    private val _ready = MutableStateFlow(false)
    val ready: StateFlow<Boolean> = _ready

    private val _user = MutableStateFlow<UserProfile?>(null)
    val user: StateFlow<UserProfile?> = _user

    init {
        // On cold start: if tokens exist but are expired, try silent refresh before showing UI
        viewModelScope.launch {
            val tokens = tokenStore.getTokens()
            if (tokens != null && tokenStore.isExpired()) {
                // Try silent refresh
                try {
                    api.fetchMyGames() // This triggers the refresh interceptor in ApiClient
                } catch (_: Exception) {
                    // Refresh failed — tokens cleared by ApiClient, isAuthenticated will be false
                }
            }
            _ready.value = true
        }

        viewModelScope.launch {
            isAuthenticated.collect { authed ->
                if (authed) {
                    runCatching { _user.value = api.fetchUserInfo() }
                    pushTokenManager.registerCurrentToken()
                    TokenRefreshWorker.schedule(workManager)
                } else {
                    _user.value = null
                    TokenRefreshWorker.cancel(workManager)
                }
            }
        }
    }

    fun handleIntent(intent: Intent) {
        val uri = intent.data ?: return
        if (uri.scheme == "convocados" && uri.host == "auth") {
            _processingAuth.value = true
            viewModelScope.launch {
                try {
                    authManager.handleCallback(uri)
                    runCatching { _user.value = api.fetchUserInfo() }
                    pushTokenManager.registerCurrentToken()
                } finally {
                    _processingAuth.value = false
                }
            }
        }
    }

    fun logout() {
        pushTokenManager.unregisterCurrentToken()
        TokenRefreshWorker.cancel(workManager)
        authManager.logout()
        _user.value = null
    }
}

@OptIn(ExperimentalPermissionsApi::class)
@Composable
fun ConvocadosRoot(deepLink: String? = null, intentVersion: Int = 0, viewModel: RootViewModel = hiltViewModel()) {
    val isAuthenticated by viewModel.isAuthenticated.collectAsState()

    // Request notification permission on Android 13+
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val permissionState = rememberPermissionState(Manifest.permission.POST_NOTIFICATIONS)
        LaunchedEffect(Unit) {
            if (!permissionState.status.isGranted) {
                permissionState.launchPermissionRequest()
            }
        }
    }

    // Handle OAuth callback and deep link intents (re-runs when intentVersion changes)
    val context = LocalContext.current
    LaunchedEffect(intentVersion) {
        val activity = context as? android.app.Activity
        activity?.intent?.let { viewModel.handleIntent(it) }
    }

    ConvocadosTheme(
        themeMode = viewModel.themeMode.collectAsState(initial = ThemeMode.System).value,
        dynamicColor = viewModel.dynamicColor.collectAsState(initial = false).value,
    ) {
        val processingAuth by viewModel.processingAuth.collectAsState()
        val ready by viewModel.ready.collectAsState()

        // Don't render navigation until we've confirmed auth state (avoids Login flash)
        if (!ready) return@ConvocadosTheme

        AppNavigation(isAuthenticated = isAuthenticated, deepLink = deepLink, processingAuth = processingAuth)
    }
}
