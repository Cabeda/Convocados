package dev.convocados.ui.screen.notifications

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.NotificationPrefs
import dev.convocados.ui.theme.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import android.Manifest
import android.os.Build

data class PrefItem(val key: String, val label: String, val desc: String? = null)
data class PrefSection(val title: String, val items: List<PrefItem>)

val SECTIONS = listOf(
    PrefSection("Push notifications", listOf(
        PrefItem("pushEnabled", "Enable push", "Master toggle for all push notifications"),
        PrefItem("playerActivityPush", "Player activity", "When players join or leave"),
        PrefItem("gameReminderPush", "Game reminders", "Before your game starts"),
        PrefItem("eventDetailsPush", "Event updates", "When event details change"),
        PrefItem("paymentReminderPush", "Payment reminders"),
    )),
    PrefSection("Email notifications", listOf(
        PrefItem("emailEnabled", "Enable email", "Master toggle for all emails"),
        PrefItem("gameReminderEmail", "Game reminders"),
        PrefItem("gameInviteEmail", "Game invites"),
        PrefItem("weeklySummaryEmail", "Weekly summary"),
        PrefItem("paymentReminderEmail", "Payment reminders"),
    )),
    PrefSection("Reminder timing", listOf(
        PrefItem("reminder24h", "24 hours before"),
        PrefItem("reminder2h", "2 hours before"),
        PrefItem("reminder1h", "1 hour before"),
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
        "weeklySummaryEmail" -> p.weeklySummaryEmail; "paymentReminderEmail" -> p.paymentReminderEmail
        "paymentReminderPush" -> p.paymentReminderPush; "reminder24h" -> p.reminder24h
        "reminder2h" -> p.reminder2h; "reminder1h" -> p.reminder1h; else -> false
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

    Scaffold(
        topBar = { TopAppBar(title = { Text("\uD83D\uDD14 Notifications") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg)) },
        containerColor = Bg,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = Primary) }; return@Scaffold }
        val p = prefs ?: return@Scaffold

        Column(Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(16.dp)) {
            SECTIONS.forEach { section ->
                Text(section.title.uppercase(), color = Primary, fontWeight = FontWeight.Bold, fontSize = 13.sp, letterSpacing = 1.sp, modifier = Modifier.padding(top = 20.dp, bottom = 8.dp))
                section.items.forEach { item ->
                    Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(item.label, color = TextPrimary, fontSize = 15.sp)
                                item.desc?.let { Text(it, color = TextMuted, fontSize = 12.sp) }
                            }
                            Switch(
                                checked = viewModel.getPrefValue(p, item.key),
                                onCheckedChange = { viewModel.toggle(item.key, it) },
                                colors = SwitchDefaults.colors(checkedThumbColor = Primary, checkedTrackColor = PrimaryDark),
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(40.dp))
        }
    }
}
