package dev.convocados.ui.screen.courts

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Notifications
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
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CourtAlternativesState(
    val loading: Boolean = false,
    val alternatives: List<CourtAlternative> = emptyList(),
    val startTime: String = "19:00",
    val endTime: String = "21:00",
    val error: String? = null,
    val watchCreated: Boolean = false,
    val sport: String = "",
    val timezone: String = "",
)

@HiltViewModel
class CourtAlternativesViewModel @Inject constructor(
    private val api: ConvocadosApi,
) : ViewModel() {
    private val _state = MutableStateFlow(CourtAlternativesState())
    val state: StateFlow<CourtAlternativesState> = _state

    fun load(eventId: String) {
        val s = _state.value
        _state.value = s.copy(loading = true, error = null)
        viewModelScope.launch {
            // Fetch event for sport/timezone if not yet loaded
            if (s.sport.isBlank()) {
                runCatching { api.fetchEvent(eventId) }.onSuccess { event ->
                    _state.value = _state.value.copy(sport = event.sport, timezone = event.timezone)
                }
            }
            runCatching {
                api.fetchCourtAlternatives(
                    eventId = eventId,
                    startTime = _state.value.startTime,
                    endTime = _state.value.endTime,
                )
            }.onSuccess { resp ->
                _state.value = _state.value.copy(loading = false, alternatives = resp.alternatives)
            }.onFailure { e ->
                _state.value = _state.value.copy(loading = false, error = e.message)
            }
        }
    }

    fun setStartTime(time: String) { _state.value = _state.value.copy(startTime = time) }
    fun setEndTime(time: String) { _state.value = _state.value.copy(endTime = time) }

    fun createWatch(alt: CourtAlternative, dayOfWeek: Int) {
        viewModelScope.launch {
            val s = _state.value
            runCatching {
                api.createCourtWatch(CreateCourtWatchRequest(
                    sport = s.sport,
                    tenantId = alt.tenantId,
                    tenantName = alt.tenantName,
                    resourceId = "",
                    resourceName = alt.resourceName,
                    dayOfWeek = dayOfWeek,
                    startTime = s.startTime,
                    endTime = s.endTime,
                    timezone = s.timezone,
                ))
            }.onSuccess {
                _state.value = _state.value.copy(watchCreated = true)
            }
        }
    }

    fun dismissWatchCreated() { _state.value = _state.value.copy(watchCreated = false) }
}

val PLAYTOMIC_SPORTS = setOf("padel", "football-5v5", "futsal", "tennis-singles", "tennis-doubles", "football-7v7")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CourtAlternativesScreen(
    eventId: String,
    onBack: () -> Unit,
    viewModel: CourtAlternativesViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    var selectedSlot by remember { mutableStateOf<CourtAlternative?>(null) }

    LaunchedEffect(eventId) { viewModel.load(eventId) }

    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(state.watchCreated) {
        if (state.watchCreated) {
            snackbarHostState.showSnackbar("Watch created! You'll be notified when it's free.")
            viewModel.dismissWatchCreated()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Court Alternatives") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp)
        ) {
            // Time filter
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = state.startTime,
                    onValueChange = { viewModel.setStartTime(it) },
                    label = { Text("From") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = state.endTime,
                    onValueChange = { viewModel.setEndTime(it) },
                    label = { Text("To") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                FilledTonalButton(onClick = { viewModel.load(eventId) }) { Text("Search") }
            }

            Spacer(Modifier.height(16.dp))

            when {
                state.loading -> Box(Modifier.fillMaxWidth(), Alignment.Center) {
                    CircularProgressIndicator()
                }
                state.error != null -> Text(state.error!!, color = MaterialTheme.colorScheme.error)
                state.alternatives.isEmpty() -> Text("No courts found for this time range.", color = MaterialTheme.colorScheme.outline)
                else -> {
                    // Group by club
                    val grouped = state.alternatives.groupBy { it.tenantName }
                    grouped.forEach { (clubName, slots) ->
                        Text(
                            clubName,
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp,
                            modifier = Modifier.padding(top = 12.dp, bottom = 4.dp),
                        )
                        if (slots.firstOrNull()?.distanceKm?.let { it > 0 } == true) {
                            Text(
                                "${String.format("%.1f", slots.first().distanceKm)} km",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.outline,
                            )
                        }
                        Row(
                            Modifier.horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            slots.forEach { slot ->
                                val isBooked = slot.status == "booked"
                                val timeLabel = slot.slotTime.substringAfter("T").take(5)
                                val priceLabel = "${slot.currency} ${String.format("%.0f", slot.price)}"

                                if (isBooked) {
                                    // Greyed chip with bell icon
                                    AssistChip(
                                        onClick = {
                                            viewModel.createWatch(slot, 1)
                                        },
                                        label = { Text("$timeLabel · $priceLabel", fontSize = 12.sp) },
                                        trailingIcon = {
                                            Icon(
                                                Icons.Default.Notifications,
                                                "Notify when free",
                                                modifier = Modifier.size(16.dp),
                                            )
                                        },
                                        colors = AssistChipDefaults.assistChipColors(
                                            containerColor = MaterialTheme.colorScheme.surfaceVariant,
                                            labelColor = MaterialTheme.colorScheme.outline,
                                        ),
                                    )
                                } else {
                                    AssistChip(
                                        onClick = { selectedSlot = slot },
                                        label = { Text("$timeLabel · $priceLabel", fontSize = 12.sp) },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Slot action dialog
    selectedSlot?.let { slot ->
        AlertDialog(
            onDismissRequest = { selectedSlot = null },
            title = { Text("${slot.tenantName} — ${slot.resourceName}") },
            text = {
                val timeLabel = slot.slotTime.substringAfter("T").take(5)
                Text("$timeLabel · ${slot.currency} ${String.format("%.0f", slot.price)}")
            },
            confirmButton = {
                TextButton(onClick = {
                    selectedSlot = null
                    if (slot.playtomicUrl.isNotBlank()) {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(slot.playtomicUrl)))
                    }
                }) { Text("Book on Playtomic", fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(onClick = { selectedSlot = null }) { Text("Cancel") }
            },
        )
    }
}
