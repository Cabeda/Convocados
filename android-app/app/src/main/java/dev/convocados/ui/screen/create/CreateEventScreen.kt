package dev.convocados.ui.screen.create

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.CreateEventRequest
import dev.convocados.ui.theme.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.time.*
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.TimeZone
import javax.inject.Inject

data class SportPreset(val id: String, val label: String, val defaultMax: Int)

val SPORT_PRESETS = listOf(
    SportPreset("football-5v5", "Football 5v5", 10),
    SportPreset("football-7v7", "Football 7v7", 14),
    SportPreset("football-11v11", "Football 11v11", 22),
    SportPreset("futsal", "Futsal", 10),
    SportPreset("basketball", "Basketball", 10),
    SportPreset("volleyball", "Volleyball", 12),
    SportPreset("tennis-singles", "Tennis (singles)", 2),
    SportPreset("tennis-doubles", "Tennis (doubles)", 4),
    SportPreset("padel", "Padel", 4),
    SportPreset("other", "Other", 10),
)

@HiltViewModel
class CreateEventViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _creating = MutableStateFlow(false)
    val creating: StateFlow<Boolean> = _creating
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    fun create(
        title: String, location: String, dateTime: Instant, sport: String,
        maxPlayers: Int, teamOneName: String, teamTwoName: String,
        isRecurring: Boolean, recurrenceFreq: String?,
        onSuccess: (String) -> Unit,
    ) {
        viewModelScope.launch {
            _creating.value = true
            _error.value = null
            runCatching {
                api.createEvent(CreateEventRequest(
                    title = title, location = location.ifBlank { null },
                    dateTime = dateTime.toString(),
                    timezone = TimeZone.getDefault().id,
                    maxPlayers = maxPlayers, sport = sport,
                    teamOneName = teamOneName.ifBlank { null },
                    teamTwoName = teamTwoName.ifBlank { null },
                    isRecurring = isRecurring,
                    recurrenceFreq = if (isRecurring) recurrenceFreq else null,
                    recurrenceInterval = if (isRecurring) 1 else null,
                ))
            }.onSuccess { onSuccess(it.id) }
                .onFailure { _error.value = it.message }
            _creating.value = false
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateEventScreen(
    onCreated: (String) -> Unit,
    onBack: () -> Unit,
    viewModel: CreateEventViewModel = hiltViewModel(),
) {
    val creating by viewModel.creating.collectAsState()
    val error by viewModel.error.collectAsState()

    var title by remember { mutableStateOf("") }
    var location by remember { mutableStateOf("") }
    var dateTime by remember { mutableStateOf(Instant.now().plusSeconds(3600).let {
        it.minusMillis(it.toEpochMilli() % 3_600_000)
    }) }
    var sport by remember { mutableStateOf("football-5v5") }
    var maxPlayers by remember { mutableStateOf("10") }
    var showAdvanced by remember { mutableStateOf(false) }
    var teamOneName by remember { mutableStateOf("Ninjas") }
    var teamTwoName by remember { mutableStateOf("Gunas") }
    var isRecurring by remember { mutableStateOf(false) }
    var recurrenceFreq by remember { mutableStateOf("weekly") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Create a Game") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg),
            )
        },
        containerColor = Bg,
    ) { padding ->
        Column(
            modifier = Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
        ) {
            error?.let { Text(it, color = Error, fontSize = 14.sp, modifier = Modifier.padding(bottom = 12.dp)) }

            Label("Game title")
            OutlinedTextField(
                value = title, onValueChange = { title = it },
                placeholder = { Text("e.g. Tuesday 5-a-side") },
                modifier = Modifier.fillMaxWidth(), singleLine = true,
                colors = textFieldColors(),
            )

            Label("Sport")
            Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SPORT_PRESETS.forEach { s ->
                    FilterChip(
                        selected = sport == s.id,
                        onClick = { sport = s.id; maxPlayers = s.defaultMax.toString() },
                        label = { Text(s.label) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = PrimaryDark, selectedLabelColor = PrimaryContainer,
                        ),
                    )
                }
            }

            Label("Location (optional)")
            OutlinedTextField(
                value = location, onValueChange = { location = it },
                placeholder = { Text("e.g. Riverside Astro, Pitch 2") },
                modifier = Modifier.fillMaxWidth(), singleLine = true,
                colors = textFieldColors(),
            )

            Label("Date & time")
            Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(14.dp), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                    val fmt = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withZone(ZoneId.systemDefault())
                    Text(fmt.format(dateTime), color = TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(-86400L to "-1d", -3600L to "-1h", 3600L to "+1h", 86400L to "+1d").forEach { (secs, label) ->
                            FilledTonalButton(onClick = { dateTime = dateTime.plusSeconds(secs) }) { Text(label) }
                        }
                    }
                }
            }

            Label("Max players")
            OutlinedTextField(
                value = maxPlayers, onValueChange = { maxPlayers = it.filter { c -> c.isDigit() } },
                modifier = Modifier.width(100.dp), singleLine = true,
                colors = textFieldColors(),
            )
            Text("Players beyond this limit go to the bench", color = TextMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))

            TextButton(onClick = { showAdvanced = !showAdvanced }, modifier = Modifier.padding(top = 16.dp)) {
                Text("${if (showAdvanced) "▼" else "▶"} Advanced options", color = TextMuted)
            }

            if (showAdvanced) {
                Label("Team 1 name")
                OutlinedTextField(value = teamOneName, onValueChange = { teamOneName = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, colors = textFieldColors())
                Label("Team 2 name")
                OutlinedTextField(value = teamTwoName, onValueChange = { teamTwoName = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, colors = textFieldColors())

                Row(modifier = Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Text("Recurring game", color = TextSecondary, modifier = Modifier.weight(1f))
                    Switch(checked = isRecurring, onCheckedChange = { isRecurring = it }, colors = SwitchDefaults.colors(checkedThumbColor = Primary, checkedTrackColor = PrimaryDark))
                }
                if (isRecurring) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                        listOf("weekly", "monthly").forEach { f ->
                            FilterChip(
                                selected = recurrenceFreq == f, onClick = { recurrenceFreq = f },
                                label = { Text(f.replaceFirstChar { it.uppercase() }) },
                                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = PrimaryDark, selectedLabelColor = PrimaryContainer),
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(24.dp))
            Button(
                onClick = {
                    val mp = maxPlayers.toIntOrNull() ?: 10
                    viewModel.create(title.trim(), location.trim(), dateTime, sport, mp, teamOneName.trim(), teamTwoName.trim(), isRecurring, recurrenceFreq, onCreated)
                },
                enabled = title.isNotBlank() && !creating,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Primary),
                shape = MaterialTheme.shapes.medium,
            ) {
                if (creating) CircularProgressIndicator(color = OnPrimary, modifier = Modifier.size(20.dp))
                else Text("Create game", color = OnPrimary, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
            Spacer(Modifier.height(40.dp))
        }
    }
}

@Composable
private fun Label(text: String) {
    Text(text, color = TextSecondary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
}

@Composable
private fun textFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
    focusedBorderColor = Primary, unfocusedBorderColor = Border,
    cursorColor = Primary,
    focusedPlaceholderColor = TextMuted, unfocusedPlaceholderColor = TextMuted,
    focusedContainerColor = SurfaceHover, unfocusedContainerColor = SurfaceHover,
)
