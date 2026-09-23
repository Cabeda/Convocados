package dev.convocados.ui.screen.profile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Public
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.credentials.CredentialManager
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import coil3.compose.SubcomposeAsyncImage
import dev.convocados.BuildConfig
import dev.convocados.R
import dev.convocados.ui.components.SectionCard
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.LinkedCredential
import dev.convocados.data.api.PendingMergeView
import dev.convocados.data.api.UserProfile
import dev.convocados.data.auth.AuthManager
import dev.convocados.data.auth.LinkResult
import dev.convocados.data.auth.TokenStore
import dev.convocados.data.datastore.SettingsStore
import dev.convocados.data.push.PushTokenManager
import dev.convocados.data.repository.UserRepository
import dev.convocados.ui.theme.ThemeMode
import dev.convocados.util.ProfilePhoto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject

data class LocaleOption(val code: String, val label: String)
val LOCALE_OPTIONS = listOf(
    LocaleOption("en", "English"), LocaleOption("pt", "Português"),
    LocaleOption("es", "Español"), LocaleOption("fr", "Français"),
    LocaleOption("de", "Deutsch"), LocaleOption("it", "Italiano"),
)

/**
 * UI state for the linked sign-in methods section (ADR 0040).
 *
 * [error] and [message] hold either a string-resource key (see
 * [resolveCredentialsError] / [resolveCredentialsMessage]) or, for server
 * rejections such as the sole-credential guard, the server's own text — the
 * same contract the web `LinkedCredentialsSection` uses.
 */
data class CredentialsUiState(
    val loading: Boolean = false,
    val linking: Boolean = false,
    val credentials: List<LinkedCredential> = emptyList(),
    val error: String? = null,
    val message: String? = null,
    val pendingMerge: PendingMergeView? = null,
    val mergeDialogOpen: Boolean = false,
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
    val dynamicColor = settingsStore.dynamicColor

    private val _credentialsUi = MutableStateFlow(CredentialsUiState())
    val credentialsUi: StateFlow<CredentialsUiState> = _credentialsUi

    init { viewModelScope.launch { repository.refreshUserProfile() } }

    fun updateName(name: String) {
        viewModelScope.launch {
            runCatching { api.updateProfile(name) }
                .onSuccess { repository.refreshUserProfile() }
        }
    }

    fun updateProfilePhoto(imageDataUrl: String) {
        viewModelScope.launch { repository.uploadProfilePhoto(imageDataUrl) }
    }

    fun removeProfilePhoto() {
        viewModelScope.launch { repository.removeProfilePhoto() }
    }

    // ── Linked sign-in methods (ADR 0040) ───────────────────────────────────

    /** Reload credentials and any pending cross-account merge interstitial. */
    fun refreshCredentials() {
        viewModelScope.launch {
            _credentialsUi.update { it.copy(loading = true) }
            runCatching {
                val creds = api.fetchCredentials().credentials
                val pending = api.fetchPendingMerge().pendingMerge
                creds to pending
            }.onSuccess { (creds, pending) ->
                _credentialsUi.update {
                    it.copy(
                        loading = false,
                        linking = false,
                        credentials = creds,
                        pendingMerge = pending,
                        mergeDialogOpen = pending != null,
                        error = null,
                    )
                }
            }.onFailure {
                _credentialsUi.update { s ->
                    s.copy(loading = false, linking = false, error = "credential_load_error")
                }
            }
        }
    }

    fun unlinkCredential(credentialId: String) {
        viewModelScope.launch {
            runCatching { api.unlinkCredential(credentialId) }
                .onSuccess {
                    _credentialsUi.update { it.copy(message = "credential_unlinked", error = null) }
                    refreshCredentials()
                }
                .onFailure { e ->
                    _credentialsUi.update {
                        it.copy(error = e.message ?: "credential_unlink_error", message = null)
                    }
                }
        }
    }

    /** Link Google via Credential Manager (no browser session needed). */
    fun linkGoogleWithCredentialManager(credentialManager: CredentialManager, activity: Activity) {
        viewModelScope.launch {
            _credentialsUi.update { it.copy(linking = true, error = null, message = null) }
            try {
                val request = authManager.buildGoogleSignInRequest()
                val response = credentialManager.getCredential(activity, request)
                val idToken = authManager.extractGoogleIdToken(response)
                if (idToken == null) {
                    _credentialsUi.update { it.copy(linking = false, error = "link_google_error") }
                    return@launch
                }
                doLinkGoogle(idToken)
            } catch (e: GetCredentialCancellationException) {
                _credentialsUi.update { it.copy(linking = false) }
            } catch (e: GetCredentialException) {
                _credentialsUi.update { it.copy(linking = false, error = "link_google_error") }
            } catch (e: Exception) {
                _credentialsUi.update { it.copy(linking = false, error = "link_google_error") }
            }
        }
    }

    /** Link Google from an already-obtained idToken. */
    fun linkGoogle(idToken: String) {
        viewModelScope.launch { doLinkGoogle(idToken) }
    }

    private suspend fun doLinkGoogle(idToken: String) {
        _credentialsUi.update { it.copy(linking = true, error = null, message = null) }
        when (authManager.linkGoogleCredential(idToken)) {
            LinkResult.Success -> {
                _credentialsUi.update { it.copy(message = "link_google_success") }
                refreshCredentials()
            }
            // Conflict captured the pending merge server-side — reload opens the
            // interstitial, matching the web callback's account_already_linked path.
            LinkResult.Conflict -> refreshCredentials()
            is LinkResult.Error ->
                _credentialsUi.update { it.copy(linking = false, error = "link_google_error") }
        }
    }

    fun confirmMerge() {
        viewModelScope.launch {
            runCatching { api.confirmMerge() }
                .onSuccess {
                    _credentialsUi.update {
                        it.copy(
                            message = "merge_success",
                            error = null,
                            pendingMerge = null,
                            mergeDialogOpen = false,
                        )
                    }
                    refreshCredentials()
                }
                .onFailure { e ->
                    _credentialsUi.update { it.copy(error = e.message ?: "merge_error") }
                }
        }
    }

    fun dismissMerge() {
        _credentialsUi.update { it.copy(mergeDialogOpen = false) }
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
    fun setDynamicColor(enabled: Boolean) { viewModelScope.launch { settingsStore.setDynamicColor(enabled) } }
}

@Composable
fun ProfileScreen(
    onLogout: () -> Unit,
    onNotificationPrefs: () -> Unit,
    onCourtWatches: () -> Unit = {},
    viewModel: ProfileViewModel = hiltViewModel(),
) {
    val user by viewModel.user.collectAsState()
    val locale by viewModel.locale.collectAsState(initial = "en")
    var editingServer by remember { mutableStateOf(false) }
    var serverUrl by remember { mutableStateOf("") }
    var showLanguages by remember { mutableStateOf(false) }
    var showEditName by remember { mutableStateOf(false) }
    var editName by remember { mutableStateOf("") }
    var pickedPhoto by remember { mutableStateOf<Uri?>(null) }
    val scope = rememberCoroutineScope()
    val credentialsUi by viewModel.credentialsUi.collectAsState()

    val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) pickedPhoto = uri
    }

    Column(
        Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        // Profile card
        user?.let { u ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    ProfileAvatar(
                        name = u.name,
                        image = u.image,
                        onClick = { photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(u.name, color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.titleLarge)
                        IconButton(onClick = { editName = u.name; showEditName = true }) {
                            Icon(Icons.Default.Edit, stringResource(R.string.edit_name), tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                        }
                    }
                    Text(u.email, color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.bodyMedium)
                    if (u.image != null) {
                        TextButton(onClick = { viewModel.removeProfilePhoto() }) {
                            Text(stringResource(R.string.remove_photo), color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }

        // Linked sign-in methods (ADR 0040)
        LaunchedEffect(Unit) { viewModel.refreshCredentials() }
        LinkedCredentialsSection(
            ui = credentialsUi,
            onUnlink = { viewModel.unlinkCredential(it) },
            onLinkGoogle = { credentialManager, activity ->
                viewModel.linkGoogleWithCredentialManager(credentialManager, activity)
            },
        )
        credentialsUi.error?.let { err ->
            Text(
                resolveCredentialsError(err),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }
        credentialsUi.message?.let { msg ->
            Text(
                resolveCredentialsMessage(msg),
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }

        // Notifications
        MenuItem(title = stringResource(R.string.notifications_title), subtitle = stringResource(R.string.notifications_subtitle), onClick = onNotificationPrefs)

        // Court Watches
        MenuItem(title = stringResource(R.string.court_watches), subtitle = stringResource(R.string.court_watches_subtitle), onClick = onCourtWatches)

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
        val themeLabel = when (themeMode) { ThemeMode.System -> stringResource(R.string.theme_system); ThemeMode.Light -> stringResource(R.string.theme_light); ThemeMode.Dark -> stringResource(R.string.theme_dark) }
        var showTheme by remember { mutableStateOf(false) }
        MenuItem(title = stringResource(R.string.theme), subtitle = themeLabel, onClick = { showTheme = !showTheme })
        if (showTheme) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                Column {
                    listOf(ThemeMode.System to stringResource(R.string.theme_system), ThemeMode.Light to stringResource(R.string.theme_light), ThemeMode.Dark to stringResource(R.string.theme_dark)).forEach { (mode, label) ->
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

        // Material You dynamic color (Android 12+)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            val dynamicColor by viewModel.dynamicColor.collectAsState(initial = false)
            SectionCard {
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 2.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.material_you), color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.material_you_desc), color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.bodySmall)
                    }
                    Switch(checked = dynamicColor, onCheckedChange = { viewModel.setDynamicColor(it) })
                }
            }
            Spacer(Modifier.height(8.dp))
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
                        TextButton(onClick = { editingServer = false }) { Text(stringResource(R.string.cancel), color = MaterialTheme.colorScheme.outline) }
                        Spacer(Modifier.width(8.dp))
                        Button(onClick = {
                            viewModel.setServerUrl(serverUrl.trim().trimEnd('/'))
                            editingServer = false
                        }, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                            Text(stringResource(R.string.save), color = MaterialTheme.colorScheme.onPrimaryContainer)
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(8.dp))

        // App version (links to GitHub releases)
        val context = LocalContext.current
        MenuItem(
            title = "v${BuildConfig.VERSION_NAME}",
            subtitle = stringResource(R.string.view_releases),
            onClick = {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/Cabeda/Convocados/releases")))
            },
        )

        Spacer(Modifier.height(40.dp))
        Button(
            onClick = { viewModel.logout(); onLogout() },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        ) { Text(stringResource(R.string.sign_out), color = MaterialTheme.colorScheme.onErrorContainer, fontWeight = FontWeight.Bold) }
    }

    // Cross-account merge interstitial (ADR 0040)
    if (credentialsUi.mergeDialogOpen) {
        val pending = credentialsUi.pendingMerge
        AlertDialog(
            onDismissRequest = { if (!credentialsUi.loading) viewModel.dismissMerge() },
            title = { Text(stringResource(R.string.merge_confirm_title)) },
            text = {
                Text(
                    pending?.let {
                        stringResource(
                            R.string.merge_confirm_desc,
                            it.absorbedEmail,
                            formatDate(it.absorbedCreatedAt),
                        )
                    } ?: stringResource(R.string.merge_error),
                )
            },
            confirmButton = {
                TextButton(onClick = { viewModel.confirmMerge() }) {
                    Text(stringResource(R.string.merge_confirm_btn), fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissMerge() }) {
                    Text(stringResource(R.string.merge_cancel_btn), color = MaterialTheme.colorScheme.outline)
                }
            },
        )
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
                }) { Text(stringResource(R.string.save), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(onClick = { showEditName = false }) { Text(stringResource(R.string.cancel), color = MaterialTheme.colorScheme.outline) }
            },
        )
    }

    // Profile photo crop
    pickedPhoto?.let { uri ->
        Dialog(
            onDismissRequest = { pickedPhoto = null },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            ProfilePhotoCropScreen(
                imageUri = uri,
                onCancel = { pickedPhoto = null },
                onConfirm = { cropped ->
                    pickedPhoto = null
                    scope.launch {
                        val dataUrl = withContext(Dispatchers.Default) { ProfilePhoto.encode(cropped) }
                        viewModel.updateProfilePhoto(dataUrl)
                    }
                },
            )
        }
    }
}

@Composable
private fun ProfileAvatar(name: String, image: String?, size: Dp = 96.dp, onClick: () -> Unit) {    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primary)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (image != null) {
            SubcomposeAsyncImage(
                model = image,
                contentDescription = name,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
                loading = { AvatarInitial(name) },
                error = { AvatarInitial(name) },
            )
        } else {
            AvatarInitial(name)
        }
        Box(
            Modifier
                .align(Alignment.BottomEnd)
                .size(28.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surface),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Default.CameraAlt,
                contentDescription = stringResource(R.string.change_photo),
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

@Composable
private fun AvatarInitial(name: String) {
    Text(
        name.trim().firstOrNull()?.uppercase() ?: "?",
        color = MaterialTheme.colorScheme.onPrimary,
        style = MaterialTheme.typography.headlineMedium,
        fontWeight = FontWeight.Bold,
    )
}

@Composable
fun MenuItem(title: String, subtitle: String, onClick: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
        onClick = onClick,
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(title, color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.titleSmall)
            Text(subtitle, color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

// ── Linked sign-in methods (ADR 0040) ──────────────────────────────────────

@Composable
private fun LinkedCredentialsSection(
    ui: CredentialsUiState,
    onUnlink: (String) -> Unit,
    onLinkGoogle: (CredentialManager, Activity) -> Unit,
) {
    val context = LocalContext.current
    val hasGoogle = ui.credentials.any { it.providerId == "google" }
    val sole = ui.credentials.size <= 1

    SectionCard {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Link,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.outline,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(R.string.linked_signins),
                    color = MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.titleMedium,
                )
            }
            Text(
                stringResource(R.string.linked_signins_desc),
                color = MaterialTheme.colorScheme.outline,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
            )

            if (ui.loading && ui.credentials.isEmpty()) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
            }

            ui.credentials.forEach { cred ->
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                providerIcon(cred.providerId),
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.outline,
                                modifier = Modifier.size(18.dp),
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                providerLabel(cred.providerId),
                                color = MaterialTheme.colorScheme.onSurface,
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        }
                        if (sole) {
                            Text(
                                stringResource(R.string.only_credential_hint),
                                color = MaterialTheme.colorScheme.secondary,
                                style = MaterialTheme.typography.labelSmall,
                                modifier = Modifier.padding(start = 26.dp, top = 2.dp),
                            )
                        }
                    }
                    if (!sole) {
                        TextButton(onClick = { onUnlink(cred.id) }) {
                            Text(
                                stringResource(R.string.unlink_credential_btn),
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                    }
                }
            }

            if (!hasGoogle) {
                val activity = context as? Activity
                Button(
                    onClick = {
                        if (activity != null) {
                            onLinkGoogle(CredentialManager.create(context), activity)
                        }
                    },
                    enabled = !ui.linking,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.secondaryContainer,
                    ),
                ) {
                    if (ui.linking) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                        )
                    } else {
                        Icon(
                            Icons.Default.PersonAdd,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                            tint = MaterialTheme.colorScheme.onSecondaryContainer,
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            stringResource(R.string.link_google_btn),
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                        )
                    }
                }
            }
        }
    }
}

/** Maps an error key to user text; anything else is a server message shown as-is (web parity). */
@Composable
private fun resolveCredentialsError(key: String): String = when (key) {
    "credential_load_error" -> stringResource(R.string.credential_load_error)
    "credential_unlink_error" -> stringResource(R.string.credential_unlink_error)
    "link_google_error" -> stringResource(R.string.link_google_error)
    "merge_error" -> stringResource(R.string.merge_error)
    else -> key
}

@Composable
private fun resolveCredentialsMessage(key: String): String = when (key) {
    "credential_unlinked" -> stringResource(R.string.credential_unlinked)
    "link_google_success" -> stringResource(R.string.link_google_success)
    "merge_success" -> stringResource(R.string.merge_success)
    else -> key
}

@Composable
private fun providerLabel(providerId: String): String = when (providerId) {
    "credential" -> stringResource(R.string.credential_password)
    "google" -> stringResource(R.string.credential_google)
    else -> providerId
}

private fun providerIcon(providerId: String) = when (providerId) {
    "credential" -> Icons.Default.Key
    "google" -> Icons.Default.Public
    else -> Icons.Default.Link
}

private fun formatDate(iso: String): String = runCatching {
    val parsed = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).parse(iso.take(19))
    parsed?.let {
        SimpleDateFormat.getDateInstance(SimpleDateFormat.MEDIUM, Locale.getDefault()).format(it)
    } ?: iso
}.getOrDefault(iso)
