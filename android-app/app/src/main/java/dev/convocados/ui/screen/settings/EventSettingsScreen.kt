package dev.convocados.ui.screen.settings

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.R
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.EventDetail
import dev.convocados.ui.screen.create.SPORT_PRESETS
import dev.convocados.ui.screen.event.SectionTitle
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class EventSettingsViewModel @Inject constructor(
    private val api: ConvocadosApi,
    private val repository: dev.convocados.data.repository.EventRepository,
) : ViewModel() {
    private val _event = MutableStateFlow<EventDetail?>(null)
    val event: StateFlow<EventDetail?> = _event
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading

    fun load(id: String) {
        viewModelScope.launch {
            _loading.value = true
            runCatching { _event.value = api.fetchEvent(id) }
            _loading.value = false
        }
    }

    fun saveTitle(id: String, title: String) = exec { api.updateTitle(id, title); load(id) }
    fun saveLocation(id: String, loc: String) = exec { api.updateLocation(id, loc); load(id) }
    fun saveSport(id: String, s: String) = exec { api.updateSport(id, s); load(id) }
    fun togglePublic(id: String, v: Boolean) = exec { api.updateVisibility(id, v); load(id) }
    fun toggleElo(id: String, v: Boolean) = exec { api.updateElo(id, v); load(id) }
    fun toggleHideEloInTeams(id: String, v: Boolean) = exec { api.updateHideEloInTeams(id, v); load(id) }
    fun toggleSplitCosts(id: String, v: Boolean) = exec { api.updateSplitCosts(id, v); load(id) }
    fun toggleBalanced(id: String, v: Boolean) = exec { api.updateBalanced(id, v); load(id) }
    fun toggleShowCompetitiveData(id: String, v: Boolean) = exec { api.updateShowCompetitiveData(id, v); load(id) }
    fun toggleManualRating(id: String, v: Boolean) = exec { api.updateAllowManualRating(id, v); load(id) }
    fun toggleMvp(id: String, v: Boolean) = exec { api.updateMvpEnabled(id, v); load(id) }
    fun toggleMvpElo(id: String, v: Boolean) = exec { api.updateMvpEloEnabled(id, v); load(id) }
    fun saveDuration(id: String, minutes: Int) = exec { api.updateDuration(id, minutes); load(id) }
    fun savePassword(id: String, pw: String?) = exec { api.updatePassword(id, pw); load(id) }
    fun archive(id: String) = exec { repository.archiveEvent(id); _event.value = _event.value?.copy(archivedAt = "archived") }
    fun unarchive(id: String) = exec { repository.unarchiveEvent(id); load(id) }
    fun transferOwnership(id: String, targetUserId: String) = exec { api.transferOwnership(id, targetUserId); load(id) }

    private fun exec(block: suspend () -> Unit) { viewModelScope.launch { runCatching { block() } } }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventSettingsScreen(
    eventId: String, onBack: () -> Unit,
    onRankings: () -> Unit, onPayments: () -> Unit, onLog: () -> Unit, onAttendance: () -> Unit,
    viewModel: EventSettingsViewModel = hiltViewModel(),
) {
    val event by viewModel.event.collectAsState()
    val loading by viewModel.loading.collectAsState()

    LaunchedEffect(eventId) { viewModel.load(eventId) }

    var title by remember(event) { mutableStateOf(event?.title ?: "") }
    var location by remember(event) { mutableStateOf(event?.location ?: "") }
    var sport by remember(event) { mutableStateOf(event?.sport ?: "") }
    var isPublic by remember(event) { mutableStateOf(event?.isPublic ?: false) }
    var eloEnabled by remember(event) { mutableStateOf(event?.eloEnabled ?: false) }
    var hideEloInTeams by remember(event) { mutableStateOf(event?.hideEloInTeams ?: false) }
    var splitCosts by remember(event) { mutableStateOf(event?.splitCostsEnabled ?: false) }
    var balanced by remember(event) { mutableStateOf(event?.balanced ?: false) }
    var showCompetitiveData by remember(event) { mutableStateOf(event?.showCompetitiveData ?: true) }
    var allowManualRating by remember(event) { mutableStateOf(event?.allowManualRating ?: false) }
    var mvpEnabled by remember(event) { mutableStateOf(event?.mvpEnabled ?: false) }
    var mvpEloEnabled by remember(event) { mutableStateOf(event?.mvpEloEnabled ?: false) }
    var durationMinutes by remember(event) { mutableStateOf(event?.durationMinutes?.toString() ?: "60") }
    var showPassword by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }

    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            TopAppBar(scrollBehavior = scrollBehavior, title = { Text(stringResource(R.string.event_settings)) }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background))
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = MaterialTheme.colorScheme.primary) }; return@Scaffold }
        val ev = event ?: return@Scaffold

        Column(Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(16.dp)) {
            // Hero header
            val accent = MaterialTheme.colorScheme.primary
            Box(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                    .background(Brush.verticalGradient(listOf(accent.copy(alpha = 0.35f), MaterialTheme.colorScheme.surface)))
                    .padding(16.dp),
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = onBack, modifier = Modifier.size(36.dp)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
                        Spacer(Modifier.weight(1f))
                    }
                    Text(ev.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                    Text(stringResource(R.string.event_settings), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Spacer(Modifier.height(8.dp))

            // Title
            SettingsLabel(stringResource(R.string.game_title))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(value = title, onValueChange = { title = it }, modifier = Modifier.weight(1f), singleLine = true)
                SaveButton { viewModel.saveTitle(eventId, title.trim()) }
            }

            // Location
            SettingsLabel(stringResource(R.string.location))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(value = location, onValueChange = { location = it }, modifier = Modifier.weight(1f), singleLine = true)
                SaveButton { viewModel.saveLocation(eventId, location.trim()) }
            }

            // Duration
            SettingsLabel(stringResource(R.string.duration))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(value = durationMinutes, onValueChange = { durationMinutes = it.filter { c -> c.isDigit() } }, modifier = Modifier.width(100.dp), singleLine = true)
                Text("min", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.weight(1f))
                SaveButton { durationMinutes.toIntOrNull()?.let { viewModel.saveDuration(eventId, it) } }
            }

            // Sport
            SettingsLabel(stringResource(R.string.sport))
            Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SPORT_PRESETS.forEach { s ->
                    FilterChip(selected = sport == s.id, onClick = { sport = s.id; viewModel.saveSport(eventId, s.id) }, label = { Text(s.label) },
                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = MaterialTheme.colorScheme.primaryContainer, selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer))
                }
            }

            // General
            SectionTitle(stringResource(R.string.general))
            ToggleRow(stringResource(R.string.public_game), isPublic) { isPublic = it; viewModel.togglePublic(eventId, it) }
            ToggleRow(stringResource(R.string.balanced_teams), balanced) { balanced = it; viewModel.toggleBalanced(eventId, it) }

            // Teams & Ratings
            SectionTitle(stringResource(R.string.teams_ratings))
            ToggleRow(stringResource(R.string.elo_ratings), eloEnabled) { eloEnabled = it; viewModel.toggleElo(eventId, it) }
            ToggleRow(stringResource(R.string.hide_elo_teams), hideEloInTeams, enabled = ev.balanced) { hideEloInTeams = it; viewModel.toggleHideEloInTeams(eventId, it) }
            ToggleRow(stringResource(R.string.allow_manual_rating), allowManualRating, enabled = ev.eloEnabled) { allowManualRating = it; viewModel.toggleManualRating(eventId, it) }
            ToggleRow(stringResource(R.string.show_competitive_data), showCompetitiveData) { showCompetitiveData = it; viewModel.toggleShowCompetitiveData(eventId, it) }

            // Features
            SectionTitle(stringResource(R.string.features))
            ToggleRow(stringResource(R.string.split_costs), splitCosts) { splitCosts = it; viewModel.toggleSplitCosts(eventId, it) }
            ToggleRow(stringResource(R.string.mvp_voting), mvpEnabled) { mvpEnabled = it; viewModel.toggleMvp(eventId, it) }
            ToggleRow(stringResource(R.string.mvp_elo), mvpEloEnabled, enabled = mvpEnabled) { mvpEloEnabled = it; viewModel.toggleMvpElo(eventId, it) }

            // Password
            SectionTitle(stringResource(R.string.access))
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), onClick = { showPassword = !showPassword }) {
                Text(if (ev.hasPassword) stringResource(R.string.password_set) else stringResource(R.string.set_password), color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(14.dp))
            }
            if (showPassword) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(value = password, onValueChange = { password = it }, placeholder = { Text(stringResource(R.string.new_password_placeholder)) }, modifier = Modifier.weight(1f), singleLine = true)
                    SaveButton { viewModel.savePassword(eventId, password.ifBlank { null }); showPassword = false; password = "" }
                }
            }

            // Danger zone
            SectionTitle(stringResource(R.string.danger_zone))

            // Transfer Ownership (owner only)
            if (ev.ownerId != null) {
                var showTransfer by remember { mutableStateOf(false) }
                val candidates = ev.players.filter { it.userId != null && it.userId != ev.ownerId }

                Button(
                    onClick = { showTransfer = true },
                    modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
                    enabled = candidates.isNotEmpty(),
                ) { Text(stringResource(R.string.transfer_ownership), color = MaterialTheme.colorScheme.onSecondaryContainer, fontWeight = FontWeight.Bold) }

                if (showTransfer) {
                    AlertDialog(
                        onDismissRequest = { showTransfer = false },
                        title = { Text(stringResource(R.string.transfer_ownership)) },
                        text = {
                            Column {
                                Text(stringResource(R.string.select_transfer_player), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                                Spacer(Modifier.height(8.dp))
                                candidates.forEach { player ->
                                    TextButton(onClick = {
                                        player.userId?.let { viewModel.transferOwnership(eventId, it) }
                                        showTransfer = false
                                    }, modifier = Modifier.fillMaxWidth()) {
                                        Text(player.name, color = MaterialTheme.colorScheme.onSurface)
                                    }
                                }
                            }
                        },
                        confirmButton = {},
                        dismissButton = { TextButton(onClick = { showTransfer = false }) { Text(stringResource(R.string.cancel)) } },
                    )
                }
            }

            Button(
                onClick = { if (ev.archivedAt != null) viewModel.unarchive(eventId) else { viewModel.archive(eventId); onBack() } },
                modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.errorContainer),
            ) { Text(if (ev.archivedAt != null) stringResource(R.string.unarchive_game) else stringResource(R.string.archive_game), color = MaterialTheme.colorScheme.onErrorContainer, fontWeight = FontWeight.Bold) }

            // Navigation
            Spacer(Modifier.height(16.dp))
            NavButton(stringResource(R.string.rankings_elo), Icons.Default.EmojiEvents, onRankings)
            NavButton(stringResource(R.string.payments), Icons.Default.Payments, onPayments)
            NavButton(stringResource(R.string.event_log), Icons.AutoMirrored.Filled.List, onLog)
            NavButton(stringResource(R.string.attendance_stats), Icons.Default.CalendarMonth, onAttendance)
            Spacer(Modifier.height(40.dp))
        }
    }
}

@Composable private fun SettingsLabel(text: String) = Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
@Composable private fun SaveButton(onClick: () -> Unit) = Button(onClick = onClick, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) { Text(stringResource(R.string.save), color = MaterialTheme.colorScheme.onPrimaryContainer, style = MaterialTheme.typography.labelMedium) }
@Composable private fun NavButton(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) = Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), onClick = onClick) { Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) { Icon(icon, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp)); Text(text, color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.labelLarge) } }

@Composable
private fun ToggleRow(label: String, checked: Boolean, enabled: Boolean = true, onCheckedChange: (Boolean) -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled, colors = SwitchDefaults.colors(checkedThumbColor = MaterialTheme.colorScheme.primary, checkedTrackColor = MaterialTheme.colorScheme.primaryContainer))
        }
    }
}
