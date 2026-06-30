package dev.convocados.ui.screen.notifications

import androidx.compose.foundation.layout.*
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.annotation.StringRes
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.R
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.NotificationPrefs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import android.Manifest
import android.os.Build

data class PrefItem(val key: String, @StringRes val labelRes: Int, @StringRes val descRes: Int? = null)
data class PrefSection(@StringRes val titleRes: Int, val items: List<PrefItem>)

val SECTIONS = listOf(
    PrefSection(R.string.push_notifications, listOf(
        PrefItem("pushEnabled", R.string.enable_push, R.string.enable_push_desc),
        PrefItem("playerActivityPush", R.string.player_activity, R.string.player_activity_desc),
        PrefItem("gameReminderPush", R.string.game_reminders, R.string.game_reminders_desc),
        PrefItem("postGamePush", R.string.post_game_results, R.string.post_game_results_desc),
        PrefItem("eventDetailsPush", R.string.event_updates, R.string.event_updates_desc),
        PrefItem("paymentReminderPush", R.string.payment_reminders),
    )),
    PrefSection(R.string.email_notifications, listOf(
        PrefItem("emailEnabled", R.string.enable_email, R.string.enable_email_desc),
        PrefItem("gameReminderEmail", R.string.game_reminders),
        PrefItem("gameInviteEmail", R.string.game_invites),
        PrefItem("weeklySummaryEmail", R.string.weekly_summary),
        PrefItem("paymentReminderEmail", R.string.payment_reminders),
    )),
    PrefSection(R.string.reminder_timing, listOf(
        PrefItem("reminder24h", R.string.reminder_24h),
        PrefItem("reminder2h", R.string.reminder_2h),
        PrefItem("reminder1h", R.string.reminder_1h),
    )),
)

@HiltViewModel
class NotificationPrefsViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _prefs = MutableStateFlow<NotificationPrefs?>(null)
    val prefs: StateFlow<NotificationPrefs?> = _prefs
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading

    init { load() }

    fun load() {
        viewModelScope.launch {
            _loading.value = true
            runCatching { api.fetchNotificationPrefs() }.onSuccess { _prefs.value = it }
            _loading.value = false
        }
    }

    fun toggle(key: String, value: Boolean) {
        val current = _prefs.value ?: return
        // Optimistic update
        _prefs.value = updatePref(current, key, value)
        viewModelScope.launch {
            runCatching { api.updateNotificationPrefs(mapOf(key to value)) }
                .onFailure { _prefs.value = current } // revert
        }
    }

    private fun updatePref(p: NotificationPrefs, key: String, v: Boolean): NotificationPrefs = when (key) {
        "emailEnabled" -> p.copy(emailEnabled = v)
        "pushEnabled" -> p.copy(pushEnabled = v)
        "gameInviteEmail" -> p.copy(gameInviteEmail = v)
        "gameInvitePush" -> p.copy(gameInvitePush = v)
        "gameReminderEmail" -> p.copy(gameReminderEmail = v)
        "gameReminderPush" -> p.copy(gameReminderPush = v)
        "playerActivityPush" -> p.copy(playerActivityPush = v)
        "eventDetailsPush" -> p.copy(eventDetailsPush = v)
        "postGamePush" -> p.copy(postGamePush = v)
        "weeklySummaryEmail" -> p.copy(weeklySummaryEmail = v)
        "paymentReminderEmail" -> p.copy(paymentReminderEmail = v)
        "paymentReminderPush" -> p.copy(paymentReminderPush = v)
        "reminder24h" -> p.copy(reminder24h = v)
        "reminder2h" -> p.copy(reminder2h = v)
        "reminder1h" -> p.copy(reminder1h = v)
        else -> p
    }

    fun getPrefValue(p: NotificationPrefs, key: String): Boolean = when (key) {
        "emailEnabled" -> p.emailEnabled; "pushEnabled" -> p.pushEnabled
        "gameInviteEmail" -> p.gameInviteEmail; "gameInvitePush" -> p.gameInvitePush
        "gameReminderEmail" -> p.gameReminderEmail; "gameReminderPush" -> p.gameReminderPush
        "playerActivityPush" -> p.playerActivityPush; "eventDetailsPush" -> p.eventDetailsPush
        "postGamePush" -> p.postGamePush; "weeklySummaryEmail" -> p.weeklySummaryEmail
        "paymentReminderEmail" -> p.paymentReminderEmail; "paymentReminderPush" -> p.paymentReminderPush
        "reminder24h" -> p.reminder24h; "reminder2h" -> p.reminder2h
        "reminder1h" -> p.reminder1h; else -> false
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalPermissionsApi::class)
@Composable
fun NotificationPrefsScreen(onBack: () -> Unit, viewModel: NotificationPrefsViewModel = hiltViewModel()) {
    val prefs by viewModel.prefs.collectAsState()
    val loading by viewModel.loading.collectAsState()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val permissionState = rememberPermissionState(Manifest.permission.POST_NOTIFICATIONS)
        LaunchedEffect(permissionState.status) {
            if (!permissionState.status.isGranted) {
                permissionState.launchPermissionRequest()
            }
        }
    }

    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = { TopAppBar(scrollBehavior = scrollBehavior, title = { Text(stringResource(R.string.notifications_title)) }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background)) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = MaterialTheme.colorScheme.primary) }; return@Scaffold }
        val p = prefs ?: return@Scaffold

        Column(Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(16.dp)) {
            // ADR 0017: Tier explanation
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer), modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                Column(Modifier.padding(14.dp)) {
                    Text(stringResource(R.string.notification_tiers_title), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(stringResource(R.string.notification_tiers_desc), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSecondaryContainer)
                }
            }

            SECTIONS.forEach { section ->
                Text(stringResource(section.titleRes).uppercase(), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium, letterSpacing = 1.sp, modifier = Modifier.padding(top = 20.dp, bottom = 8.dp))
                section.items.forEach { item ->
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(stringResource(item.labelRes), color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.titleSmall)
                                item.descRes?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.bodySmall) }
                            }
                            Switch(
                                checked = viewModel.getPrefValue(p, item.key),
                                onCheckedChange = { viewModel.toggle(item.key, it) },
                                colors = SwitchDefaults.colors(checkedThumbColor = MaterialTheme.colorScheme.primary, checkedTrackColor = MaterialTheme.colorScheme.primaryContainer),
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(40.dp))
        }
    }
}
