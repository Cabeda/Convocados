package dev.convocados.ui.screen.history

import androidx.compose.foundation.layout.*
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Check
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
import dev.convocados.data.api.GameHistory
import dev.convocados.ui.screen.games.formatRelativeDate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import javax.inject.Inject

data class TeamPlayer(val id: String, val name: String)
data class PaymentEntry(val name: String, val status: String, val amount: Double? = null)

@HiltViewModel
class HistoryDetailViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _history = MutableStateFlow<GameHistory?>(null)
    val history: StateFlow<GameHistory?> = _history
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading
    private val _teamOne = MutableStateFlow<List<TeamPlayer>>(emptyList())
    val teamOne: StateFlow<List<TeamPlayer>> = _teamOne
    private val _teamTwo = MutableStateFlow<List<TeamPlayer>>(emptyList())
    val teamTwo: StateFlow<List<TeamPlayer>> = _teamTwo
    private val _payments = MutableStateFlow<List<PaymentEntry>>(emptyList())
    val payments: StateFlow<List<PaymentEntry>> = _payments
    private val _saving = MutableStateFlow(false)
    val saving: StateFlow<Boolean> = _saving
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    fun load(eventId: String, historyId: String) {
        viewModelScope.launch {
            _loading.value = true
            runCatching { api.fetchHistory(eventId) }.onSuccess { paginated ->
                val entry = paginated.data.find { it.id == historyId }
                _history.value = entry
                entry?.let { parseSnapshots(it) }
            }
            _loading.value = false
        }
    }

    private fun parseSnapshots(h: GameHistory) {
        // Parse teamsSnapshot JSON: {"teamOne": [{id, name}], "teamTwo": [{id, name}]}
        h.teamsSnapshot?.let { raw ->
            runCatching {
                val json = Json.parseToJsonElement(raw).jsonObject
                _teamOne.value = json["teamOne"]?.jsonArray?.map {
                    val obj = it.jsonObject
                    TeamPlayer(obj["id"]?.jsonPrimitive?.content ?: "", obj["name"]?.jsonPrimitive?.content ?: "")
                } ?: emptyList()
                _teamTwo.value = json["teamTwo"]?.jsonArray?.map {
                    val obj = it.jsonObject
                    TeamPlayer(obj["id"]?.jsonPrimitive?.content ?: "", obj["name"]?.jsonPrimitive?.content ?: "")
                } ?: emptyList()
            }
        }
        // Parse paymentsSnapshot JSON: [{name, status, amount?}]
        h.paymentsSnapshot?.let { raw ->
            runCatching {
                val arr = Json.parseToJsonElement(raw).jsonArray
                _payments.value = arr.map {
                    val obj = it.jsonObject
                    PaymentEntry(
                        name = obj["name"]?.jsonPrimitive?.content ?: "",
                        status = obj["status"]?.jsonPrimitive?.content ?: "unpaid",
                        amount = obj["amount"]?.jsonPrimitive?.doubleOrNull,
                    )
                }
            }
        }
    }

    fun updateScore(eventId: String, historyId: String, scoreOne: Int, scoreTwo: Int) {
        viewModelScope.launch {
            _saving.value = true
            runCatching { api.updateScore(eventId, historyId, scoreOne, scoreTwo) }
                .onSuccess { _history.value = it }
                .onFailure { e ->
                    val body = e.message ?: ""
                    val match = Regex(""""error"\s*:\s*"([^"]+)"""").find(body)
                    _error.value = match?.groupValues?.get(1) ?: "Failed to update score"
                }
            _saving.value = false
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryDetailScreen(
    eventId: String,
    historyId: String,
    onBack: () -> Unit,
    viewModel: HistoryDetailViewModel = hiltViewModel(),
) {
    val history by viewModel.history.collectAsState()
    val loading by viewModel.loading.collectAsState()
    val teamOne by viewModel.teamOne.collectAsState()
    val teamTwo by viewModel.teamTwo.collectAsState()
    val payments by viewModel.payments.collectAsState()
    val saving by viewModel.saving.collectAsState()
    var editing by remember { mutableStateOf(false) }
    var scoreOneText by remember { mutableStateOf("") }
    var scoreTwoText by remember { mutableStateOf("") }

    LaunchedEffect(eventId, historyId) { viewModel.load(eventId, historyId) }
    LaunchedEffect(history) {
        history?.let {
            scoreOneText = it.scoreOne?.toString() ?: ""
            scoreTwoText = it.scoreTwo?.toString() ?: ""
        }
    }

    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            TopAppBar(scrollBehavior = scrollBehavior, 
                title = { Text(stringResource(R.string.game_details)) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } },
                actions = {
                    if (history?.editable == true) {
                        IconButton(onClick = {
                            if (editing) {
                                val s1 = scoreOneText.toIntOrNull()
                                val s2 = scoreTwoText.toIntOrNull()
                                if (s1 != null && s2 != null) {
                                    viewModel.updateScore(eventId, historyId, s1, s2)
                                }
                                editing = false
                            } else {
                                editing = true
                            }
                        }) {
                            Icon(if (editing) Icons.Default.Check else Icons.Default.Edit, if (editing) "Save" else "Edit")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (loading) {
            Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator() }
            return@Scaffold
        }

        val h = history
        if (h == null) {
            Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { Text("Not found", color = MaterialTheme.colorScheme.error) }
            return@Scaffold
        }

        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            // Date & status
            item {
                Text(formatRelativeDate(h.dateTime), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }

            // Score section
            item {
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(stringResource(R.string.score), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                        Spacer(Modifier.height(8.dp))
                        if (editing) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text(h.teamOneName, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    OutlinedTextField(value = scoreOneText, onValueChange = { scoreOneText = it }, modifier = Modifier.width(60.dp), singleLine = true)
                                }
                                Text("—", style = MaterialTheme.typography.titleLarge)
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text(h.teamTwoName, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    OutlinedTextField(value = scoreTwoText, onValueChange = { scoreTwoText = it }, modifier = Modifier.width(60.dp), singleLine = true)
                                }
                            }
                            if (saving) { LinearProgressIndicator(modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) }
                        } else {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text(h.teamOneName, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text("${h.scoreOne ?: "—"}", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
                                }
                                Text(":", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.outline)
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text(h.teamTwoName, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text("${h.scoreTwo ?: "—"}", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                    }
                }
            }

            // Teams section
            if (teamOne.isNotEmpty() || teamTwo.isNotEmpty()) {
                item {
                    Text(stringResource(R.string.players), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(top = 4.dp))
                }
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        // Team One
                        ElevatedCard(modifier = Modifier.weight(1f)) {
                            Column(Modifier.padding(12.dp)) {
                                Text(h.teamOneName, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                                Spacer(Modifier.height(6.dp))
                                teamOne.forEach { p -> Text(p.name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface) }
                            }
                        }
                        // Team Two
                        ElevatedCard(modifier = Modifier.weight(1f)) {
                            Column(Modifier.padding(12.dp)) {
                                Text(h.teamTwoName, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.tertiary)
                                Spacer(Modifier.height(6.dp))
                                teamTwo.forEach { p -> Text(p.name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface) }
                            }
                        }
                    }
                }
            }

            // ELO updates
            h.eloUpdates?.takeIf { it.isNotEmpty() }?.let { updates ->
                item {
                    Text(stringResource(R.string.elo_changes), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(top = 4.dp))
                }
                items(updates) { eu ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(eu.name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface)
                        Text(
                            "${if (eu.delta > 0) "+" else ""}${eu.delta}",
                            style = MaterialTheme.typography.labelMedium,
                            color = if (eu.delta > 0) MaterialTheme.colorScheme.primary else if (eu.delta < 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline,
                        )
                    }
                }
            }

            // Payments section
            if (payments.isNotEmpty()) {
                item {
                    Text(stringResource(R.string.payments), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(top = 4.dp))
                }
                items(payments) { p ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(p.name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface)
                        Text(
                            p.status.replaceFirstChar { it.uppercase() },
                            style = MaterialTheme.typography.labelMedium,
                            color = if (p.status == "paid") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                        )
                    }
                }
            }
        }
    }
}
