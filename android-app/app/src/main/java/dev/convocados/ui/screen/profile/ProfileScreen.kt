package dev.convocados.ui.screen.profile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.UserProfile
import dev.convocados.data.auth.AuthManager
import dev.convocados.data.auth.TokenStore
import dev.convocados.data.datastore.SettingsStore
import dev.convocados.data.push.PushTokenManager
import dev.convocados.ui.theme.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LocaleOption(val code: String, val label: String)
val LOCALE_OPTIONS = listOf(
    LocaleOption("en", "English"), LocaleOption("pt", "Português"),
    LocaleOption("es", "Español"), LocaleOption("fr", "Français"),
    LocaleOption("de", "Deutsch"), LocaleOption("it", "Italiano"),
)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val api: ConvocadosApi,
    private val authManager: AuthManager,
    private val tokenStore: TokenStore,
    private val settingsStore: SettingsStore,
    private val pushTokenManager: PushTokenManager,
) : ViewModel() {
    private val _user = MutableStateFlow<UserProfile?>(null)
    val user: StateFlow<UserProfile?> = _user
    val locale = settingsStore.locale

    init { viewModelScope.launch { runCatching { _user.value = api.fetchUserInfo() } } }

    fun logout() { pushTokenManager.unregisterCurrentToken(); authManager.logout() }
    fun getServerUrl() = tokenStore.getServerUrl()
    fun setServerUrl(url: String) = tokenStore.setServerUrl(url)
    fun setLocale(code: String) { viewModelScope.launch { settingsStore.setLocale(code) } }
}

@Composable
fun ProfileScreen(
    onLogout: () -> Unit,
    onNotificationPrefs: () -> Unit,
    viewModel: ProfileViewModel = hiltViewModel(),
) {
    val user by viewModel.user.collectAsState()
    val locale by viewModel.locale.collectAsState(initial = "en")
    var editingServer by remember { mutableStateOf(false) }
    var serverUrl by remember { mutableStateOf("") }
    var showLanguages by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        // Profile card
        user?.let { u ->
            Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(u.name, color = TextPrimary, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                    Text(u.email, color = TextMuted, fontSize = 14.sp)
                }
            }
            Spacer(Modifier.height(16.dp))
        }

        // Notifications
        MenuItem(title = "\uD83D\uDD14 Notifications", subtitle = "Manage push & email preferences", onClick = onNotificationPrefs)

        // Language
        MenuItem(title = "Language", subtitle = LOCALE_OPTIONS.find { it.code == locale }?.label ?: "English", onClick = { showLanguages = !showLanguages })
        if (showLanguages) {
            Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                Column {
                    LOCALE_OPTIONS.forEach { opt ->
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)
                                .let { if (locale == opt.code) it else it },
                            horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(opt.label, color = if (locale == opt.code) PrimaryContainer else TextPrimary)
                            if (locale == opt.code) Text("✓", color = Primary, fontWeight = FontWeight.Bold)
                        }
                        if (opt != LOCALE_OPTIONS.last()) HorizontalDivider(color = Border)
                    }
                }
            }
        }

        // Server URL
        MenuItem(title = "Server URL", subtitle = "Configure instance", onClick = {
            serverUrl = viewModel.getServerUrl()
            editingServer = true
        })
        if (editingServer) {
            Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                Column(Modifier.padding(12.dp)) {
                    OutlinedTextField(
                        value = serverUrl, onValueChange = { serverUrl = it },
                        placeholder = { Text("https://convocados.cabeda.dev") },
                        modifier = Modifier.fillMaxWidth(), singleLine = true,
                    )
                    Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.End) {
                        TextButton(onClick = { editingServer = false }) { Text("Cancel", color = TextMuted) }
                        Spacer(Modifier.width(8.dp))
                        Button(onClick = {
                            viewModel.setServerUrl(serverUrl.trim().trimEnd('/'))
                            editingServer = false
                        }, colors = ButtonDefaults.buttonColors(containerColor = PrimaryDark)) {
                            Text("Save", color = PrimaryContainer)
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(40.dp))
        Button(
            onClick = { viewModel.logout(); onLogout() },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = ErrorBg),
        ) { Text("Sign out", color = ErrorText, fontWeight = FontWeight.Bold) }
    }
}

@Composable
fun MenuItem(title: String, subtitle: String, onClick: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Surface),
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
        onClick = onClick,
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(title, color = TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(subtitle, color = TextMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
        }
    }
}
