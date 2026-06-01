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
    private val workManager: WorkManager,
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
        TokenRefreshWorker.cancel(workManager)
        authManager.logout()
        _user.value = null
    }
}

@OptIn(ExperimentalPermissionsApi::class)
@Composable
fun ConvocadosRoot(deepLink: String? = null, viewModel: RootViewModel = hiltViewModel()) {
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

    // Handle deep link intent
    val context = LocalContext.current
    LaunchedEffect(Unit) {
        val activity = context as? android.app.Activity
        activity?.intent?.let { viewModel.handleIntent(it) }
    }

    ConvocadosTheme {
        AppNavigation(isAuthenticated = isAuthenticated, deepLink = deepLink)
    }
}
