package dev.convocados.ui.screen.profile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import dev.convocados.R
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.UserProfile
import dev.convocados.data.auth.AuthManager
import dev.convocados.data.auth.TokenStore
import dev.convocados.data.datastore.SettingsStore
import dev.convocados.data.push.PushTokenManager
import dev.convocados.data.repository.UserRepository
import dev.convocados.ui.theme.ThemeMode
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
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
    private val repository: UserRepository,
    private val api: ConvocadosApi,
    private val authManager: AuthManager,
    private val tokenStore: TokenStore,
    private val settingsStore: SettingsStore,
    private val pushTokenManager: PushTokenManager,
) : ViewModel() {
    val user: StateFlow<UserProfile?> = repository.userProfile
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)
    val locale = settingsStore.locale
    val themeMode = settingsStore.themeMode

    init { viewModelScope.launch { repository.refreshUserProfile() } }

    fun updateName(name: String) {
        viewModelScope.launch {
            runCatching { api.updateProfile(name) }
                .onSuccess { repository.refreshUserProfile() }
        }
    }

    fun logout() { 
        viewModelScope.launch {
            pushTokenManager.unregisterCurrentToken()
            authManager.logout()
            repository.clearUser()
        }
    }
    fun getServerUrl() = tokenStore.getServerUrl()
    fun setServerUrl(url: String) = tokenStore.setServerUrl(url)
    fun setLocale(code: String) { viewModelScope.launch { settingsStore.setLocale(code) } }
    fun setThemeMode(mode: ThemeMode) { viewModelScope.launch { settingsStore.setThemeMode(mode) } }
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
    var showEditName by remember { mutableStateOf(false) }
    var editName by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        // Profile card
        user?.let { u ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(u.name, color = MaterialTheme.colorScheme.onSurface, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                        IconButton(onClick = { editName = u.name; showEditName = true }) {
                            Icon(Icons.Default.Edit, stringResource(R.string.edit_name), tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                        }
                    }
                    Text(u.email, color = MaterialTheme.colorScheme.outline, fontSize = 14.sp)
                }
            }
            Spacer(Modifier.height(16.dp))
        }

        // Notifications
        MenuItem(title = "\uD83D\uDD14 ${stringResource(R.string.notifications_title)}", subtitle = stringResource(R.string.notifications_subtitle), onClick = onNotificationPrefs)

        // Language
        MenuItem(title = stringResource(R.string.language), subtitle = LOCALE_OPTIONS.find { it.code == locale }?.label ?: "English", onClick = { showLanguages = !showLanguages })
        if (showLanguages) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                Column {
                    LOCALE_OPTIONS.forEach { opt ->
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)
                                .clickable { viewModel.setLocale(opt.code); showLanguages = false },
                            horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(opt.label, color = if (locale == opt.code) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface, fontWeight = if (locale == opt.code) FontWeight.Bold else FontWeight.Normal)
                            if (locale == opt.code) Text("✓", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                        }
                        if (opt != LOCALE_OPTIONS.last()) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }

        // Theme
        val themeMode by viewModel.themeMode.collectAsState(initial = ThemeMode.System)
        val themeLabel = when (themeMode) { ThemeMode.System -> "System"; ThemeMode.Light -> "Light"; ThemeMode.Dark -> "Dark" }
        var showTheme by remember { mutableStateOf(false) }
        MenuItem(title = "Theme", subtitle = themeLabel, onClick = { showTheme = !showTheme })
        if (showTheme) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                Column {
                    listOf(ThemeMode.System to "System", ThemeMode.Light to "Light", ThemeMode.Dark to "Dark").forEach { (mode, label) ->
                        Row(
                            Modifier.fillMaxWidth().clickable { viewModel.setThemeMode(mode); showTheme = false }.padding(horizontal = 16.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(label, color = if (themeMode == mode) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface, fontWeight = if (themeMode == mode) FontWeight.Bold else FontWeight.Normal)
                            if (themeMode == mode) Text("✓", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                        }
                        if (mode != ThemeMode.Dark) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }

        // Server URL
        MenuItem(title = stringResource(R.string.server_url), subtitle = stringResource(R.string.configure_instance), onClick = {
            serverUrl = viewModel.getServerUrl()
            editingServer = true
        })
        if (editingServer) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                Column(Modifier.padding(12.dp)) {
                    OutlinedTextField(
                        value = serverUrl, onValueChange = { serverUrl = it },
                        placeholder = { Text("https://convocados.cabeda.dev") },
                        modifier = Modifier.fillMaxWidth(), singleLine = true,
                    )
                    Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.End) {
                        TextButton(onClick = { editingServer = false }) { Text("Cancel", color = MaterialTheme.colorScheme.outline) }
                        Spacer(Modifier.width(8.dp))
                        Button(onClick = {
                            viewModel.setServerUrl(serverUrl.trim().trimEnd('/'))
                            editingServer = false
                        }, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                            Text("Save", color = MaterialTheme.colorScheme.onPrimaryContainer)
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(40.dp))
        Button(
            onClick = { viewModel.logout(); onLogout() },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        ) { Text(stringResource(R.string.sign_out), color = MaterialTheme.colorScheme.onErrorContainer, fontWeight = FontWeight.Bold) }
    }

    // Edit name dialog
    if (showEditName) {
        AlertDialog(
            onDismissRequest = { showEditName = false },
            title = { Text(stringResource(R.string.edit_name)) },
            text = {
                OutlinedTextField(value = editName, onValueChange = { editName = it }, singleLine = true, modifier = Modifier.fillMaxWidth())
            },
            confirmButton = {
                TextButton(onClick = {
                    if (editName.isNotBlank()) { viewModel.updateName(editName.trim()); showEditName = false }
                }) { Text("Save", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(onClick = { showEditName = false }) { Text("Cancel", color = MaterialTheme.colorScheme.outline) }
            },
        )
    }
}

@Composable
fun MenuItem(title: String, subtitle: String, onClick: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
        onClick = onClick,
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(title, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(subtitle, color = MaterialTheme.colorScheme.outline, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
        }
    }
}
