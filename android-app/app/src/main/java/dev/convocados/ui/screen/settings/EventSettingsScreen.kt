package dev.convocados.ui.screen.settings

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
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
import dev.convocados.data.api.EventDetail
import dev.convocados.ui.screen.create.SPORT_PRESETS
import dev.convocados.ui.screen.event.SectionTitle
import dev.convocados.ui.theme.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class EventSettingsViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
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
    fun saveMaxPlayers(id: String, n: Int) = exec { api.updateMaxPlayers(id, n); load(id) }
    fun saveSport(id: String, s: String) = exec { api.updateSport(id, s); load(id) }
    fun togglePublic(id: String, v: Boolean) = exec { api.updateVisibility(id, v); load(id) }
    fun toggleElo(id: String, v: Boolean) = exec { api.updateElo(id, v); load(id) }
    fun toggleSplitCosts(id: String, v: Boolean) = exec { api.updateSplitCosts(id, v); load(id) }
    fun savePassword(id: String, pw: String?) = exec { api.updatePassword(id, pw); load(id) }
    fun archive(id: String) = exec { api.archiveEvent(id) }
    fun unarchive(id: String) = exec { api.unarchiveEvent(id); load(id) }

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
    var maxPlayers by remember(event) { mutableStateOf(event?.maxPlayers?.toString() ?: "") }
    var sport by remember(event) { mutableStateOf(event?.sport ?: "") }
    var isPublic by remember(event) { mutableStateOf(event?.isPublic ?: false) }
    var eloEnabled by remember(event) { mutableStateOf(event?.eloEnabled ?: false) }
    var splitCosts by remember(event) { mutableStateOf(event?.splitCostsEnabled ?: false) }
    var showPassword by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Event Settings") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg))
        },
        containerColor = Bg,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = Primary) }; return@Scaffold }
        val ev = event ?: return@Scaffold

        Column(Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(16.dp)) {
            // Title
            SettingsLabel("Game title")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(value = title, onValueChange = { title = it }, modifier = Modifier.weight(1f), singleLine = true)
                SaveButton { viewModel.saveTitle(eventId, title.trim()) }
            }

            // Location
            SettingsLabel("Location")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(value = location, onValueChange = { location = it }, modifier = Modifier.weight(1f), singleLine = true)
                SaveButton { viewModel.saveLocation(eventId, location.trim()) }
            }

            // Max players
            SettingsLabel("Max players")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(value = maxPlayers, onValueChange = { maxPlayers = it.filter { c -> c.isDigit() } }, modifier = Modifier.width(100.dp), singleLine = true)
                SaveButton { maxPlayers.toIntOrNull()?.let { viewModel.saveMaxPlayers(eventId, it) } }
            }

            // Sport
            SettingsLabel("Sport")
            Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SPORT_PRESETS.forEach { s ->
                    FilterChip(selected = sport == s.id, onClick = { sport = s.id; viewModel.saveSport(eventId, s.id) }, label = { Text(s.label) },
                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = PrimaryDark, selectedLabelColor = PrimaryContainer))
                }
            }

            // Toggles
            Spacer(Modifier.height(16.dp))
            ToggleRow("Public game", isPublic) { isPublic = it; viewModel.togglePublic(eventId, it) }
            ToggleRow("ELO ratings", eloEnabled) { eloEnabled = it; viewModel.toggleElo(eventId, it) }
            ToggleRow("Split costs", splitCosts) { splitCosts = it; viewModel.toggleSplitCosts(eventId, it) }

            // Password
            SectionTitle("Access")
            Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), onClick = { showPassword = !showPassword }) {
                Text(if (ev.hasPassword) "\uD83D\uDD12 Password set — tap to change/remove" else "\uD83D\uDD13 Set password", color = TextPrimary, fontSize = 14.sp, modifier = Modifier.padding(14.dp))
            }
            if (showPassword) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(value = password, onValueChange = { password = it }, placeholder = { Text("New password (empty to remove)") }, modifier = Modifier.weight(1f), singleLine = true)
                    SaveButton { viewModel.savePassword(eventId, password.ifBlank { null }); showPassword = false; password = "" }
                }
            }

            // Danger zone
            SectionTitle("Danger zone")
            Button(
                onClick = { if (ev.archivedAt != null) viewModel.unarchive(eventId) else { viewModel.archive(eventId); onBack() } },
                modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = ErrorBg),
            ) { Text(if (ev.archivedAt != null) "Unarchive game" else "Archive game", color = ErrorText, fontWeight = FontWeight.Bold) }

            // Navigation
            Spacer(Modifier.height(16.dp))
            NavButton("\uD83C\uDFC6 Rankings / ELO", onRankings)
            NavButton("\uD83D\uDCB0 Payments", onPayments)
            NavButton("\uD83D\uDCCB Event log", onLog)
            NavButton("\uD83D\uDCC5 Attendance stats", onAttendance)
            Spacer(Modifier.height(40.dp))
        }
    }
}

@Composable private fun SettingsLabel(text: String) = Text(text, color = TextSecondary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
@Composable private fun SaveButton(onClick: () -> Unit) = Button(onClick = onClick, colors = ButtonDefaults.buttonColors(containerColor = PrimaryDark)) { Text("Save", color = PrimaryContainer, fontWeight = FontWeight.SemiBold, fontSize = 13.sp) }
@Composable private fun NavButton(text: String, onClick: () -> Unit) = Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), onClick = onClick) { Text(text, color = TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(14.dp)) }

@Composable
private fun ToggleRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, color = TextPrimary, fontSize = 15.sp, modifier = Modifier.weight(1f))
            Switch(checked = checked, onCheckedChange = onCheckedChange, colors = SwitchDefaults.colors(checkedThumbColor = Primary, checkedTrackColor = PrimaryDark))
        }
    }
}
