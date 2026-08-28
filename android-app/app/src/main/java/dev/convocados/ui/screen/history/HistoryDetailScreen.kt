package dev.convocados.ui.screen.history

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.style.TextAlign
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
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import dev.convocados.R
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.GameHistory
import dev.convocados.data.api.SnapshotPaymentEntry
import dev.convocados.data.api.SnapshotTeam
import dev.convocados.data.api.SnapshotTeamPlayer
import dev.convocados.data.api.SetScore
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
            // Prefer the single-history GET; fall back to the paginated list +
            // find while the backend doesn't yet serve it (details beyond page 1
            // stay unavailable until the GET is deployed).
            val entry = runCatching { api.fetchHistoryDetail(eventId, historyId) }
                .getOrElse { runCatching { api.fetchHistory(eventId).data.find { it.id == historyId } }.getOrNull() }
            if (entry != null) {
                _history.value = entry
                parseSnapshots(entry)
            } else {
                _error.value = "Not found"
            }
            _loading.value = false
        }
    }

    private fun parseSnapshots(h: GameHistory) {
        h.teamsSnapshot?.let { raw -> runCatching { parseTeamsSnapshot(raw) } }
        h.paymentsSnapshot?.let { raw ->
            runCatching {
                val arr = Json.parseToJsonElement(raw).jsonArray
                _payments.value = arr.map {
                    val obj = it.jsonObject
                    PaymentEntry(
                        name = obj["playerName"]?.jsonPrimitive?.content ?: obj["name"]?.jsonPrimitive?.content ?: "",
                        status = obj["status"]?.jsonPrimitive?.content ?: "pending",
                        amount = obj["amount"]?.jsonPrimitive?.doubleOrNull,
                    )
                }
            }
        }
    }

    /** Server stores teams as a JSON array [{team, players:[{name, order}]}]; also
     *  tolerate the older {teamOne:[{id,name}], teamTwo:[...]} shape. */
    private fun parseTeamsSnapshot(raw: String) {
        val (one, two) = when (val root = Json.parseToJsonElement(raw)) {
            is JsonArray -> {
                val teams = root.map { it.jsonObject }
                (teams.getOrNull(0)?.teamPlayers() ?: emptyList()) to (teams.getOrNull(1)?.teamPlayers() ?: emptyList())
            }
            is JsonObject -> {
                val one = root["teamOne"]?.jsonArray?.map { obj -> TeamPlayer(obj.jsonObject["id"]?.jsonPrimitive?.content ?: "", obj.jsonObject["name"]?.jsonPrimitive?.content ?: "") } ?: emptyList()
                val two = root["teamTwo"]?.jsonArray?.map { obj -> TeamPlayer(obj.jsonObject["id"]?.jsonPrimitive?.content ?: "", obj.jsonObject["name"]?.jsonPrimitive?.content ?: "") } ?: emptyList()
                one to two
            }
            else -> emptyList<TeamPlayer>() to emptyList<TeamPlayer>()
        }
        _teamOne.value = one
        _teamTwo.value = two
    }

    private fun JsonObject.teamPlayers(): List<TeamPlayer> =
        (this["players"]?.jsonArray ?: emptyList()).map { p -> TeamPlayer("", p.jsonObject["name"]?.jsonPrimitive?.content ?: "") }

    fun togglePayment(eventId: String, historyId: String, index: Int) {
        val current = _payments.value
        val updated = current.mapIndexed { i, p -> if (i == index) p.copy(status = if (p.status == "paid") "pending" else "paid") else p }
        _payments.value = updated
        pushSnapshot(eventId, historyId)
    }

    fun movePlayer(eventId: String, historyId: String, name: String, toTeamTwo: Boolean) {
        val one = _teamOne.value
        val two = _teamTwo.value
        val from = if (toTeamTwo) one else two
        if (from.none { it.name == name }) return
        val newFrom = from.filterNot { it.name == name }
        val newTo = (if (toTeamTwo) two else one) + TeamPlayer("", name)
        _teamOne.value = if (toTeamTwo) newFrom else newTo
        _teamTwo.value = if (toTeamTwo) newTo else newFrom
        pushSnapshot(eventId, historyId)
    }

    private fun pushSnapshot(eventId: String, historyId: String) {
        val h = _history.value ?: return
        viewModelScope.launch {
            _saving.value = true
            runCatching {
                val payments = _payments.value.map { SnapshotPaymentEntry(it.name, it.status, it.amount) }
                val teams = listOf(
                    SnapshotTeam(h.teamOneName, _teamOne.value.map { SnapshotTeamPlayer(it.name) }),
                    SnapshotTeam(h.teamTwoName, _teamTwo.value.map { SnapshotTeamPlayer(it.name) }),
                )
                api.updateHistorySnapshot(eventId, historyId, payments, teams)
            }.onSuccess { _history.value = it }.onFailure { _error.value = it.message }
            _saving.value = false
        }
    }

    fun updateScore(eventId: String, historyId: String, scoreOne: Int? = null, scoreTwo: Int? = null, scoreSets: List<SetScore>? = null) {
        viewModelScope.launch {
            _saving.value = true
            runCatching { api.updateScore(eventId, historyId, scoreOne, scoreTwo, scoreSets) }
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
    var scoreSets by remember { mutableStateOf<List<SetScore>>(emptyList()) }

    LaunchedEffect(eventId, historyId) { viewModel.load(eventId, historyId) }
    LaunchedEffect(history) {
        history?.let {
            scoreOneText = it.scoreOne?.toString() ?: ""
            scoreTwoText = it.scoreTwo?.toString() ?: ""
            scoreSets = it.scoreSets ?: emptyList()
        }
    }

    val accent = MaterialTheme.colorScheme.primary
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.game_details)) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } },
                actions = {
                    if (history != null) {
                        IconButton(onClick = {
                            if (editing) {
                                if (history?.scoringType == "tennis") {
                                    if (scoreSets.isNotEmpty()) {
                                        viewModel.updateScore(eventId, historyId, scoreSets = scoreSets)
                                    } else {
                                        val s1 = scoreOneText.toIntOrNull()
                                        val s2 = scoreTwoText.toIntOrNull()
                                        if (s1 != null && s2 != null) viewModel.updateScore(eventId, historyId, s1, s2)
                                    }
                                } else {
                                    val s1 = scoreOneText.toIntOrNull()
                                    val s2 = scoreTwoText.toIntOrNull()
                                    if (s1 != null && s2 != null) viewModel.updateScore(eventId, historyId, s1, s2)
                                }
                                editing = false
                            } else editing = true
                        }) {
                            Icon(if (editing) Icons.Default.Check else Icons.Default.Edit, if (editing) stringResource(R.string.save) else stringResource(R.string.edit))
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = accent) }; return@Scaffold }
        val h = history
        if (h == null) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { Text(stringResource(R.string.not_found), color = MaterialTheme.colorScheme.error) }; return@Scaffold }

        Column(
            Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Hero — gradient score display
            Box(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                    .background(Brush.verticalGradient(listOf(accent.copy(alpha = 0.30f), MaterialTheme.colorScheme.surface)))
                    .padding(20.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ScoreColumn(h.teamOneName, h.scoreOne, accent, h.scoreSets, true, Modifier.weight(1f))
                    Text(":", fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.outline)
                    ScoreColumn(h.teamTwoName, h.scoreTwo, MaterialTheme.colorScheme.tertiary, h.scoreSets, false, Modifier.weight(1f))
                }
            }

            // Score editor (tap edit → editable score)
            if (editing) {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                    if (h.scoringType == "tennis") {
                        TennisSetEditor(scoreSets) { scoreSets = it }
                    } else {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(h.teamOneName, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            OutlinedTextField(value = scoreOneText, onValueChange = { scoreOneText = it }, modifier = Modifier.width(60.dp), singleLine = true)
                        }
                        Text("-", color = MaterialTheme.colorScheme.outline, fontWeight = FontWeight.Bold)
                        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(h.teamTwoName, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            OutlinedTextField(value = scoreTwoText, onValueChange = { scoreTwoText = it }, modifier = Modifier.width(60.dp), singleLine = true)
                        }
                    }
                    }
                    if (saving) LinearProgressIndicator(Modifier.fillMaxWidth())
                }
            }

            Text(formatRelativeDate(h.dateTime), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            if (h.status != "played") {
                Box(Modifier.clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.secondaryContainer).padding(horizontal = 10.dp, vertical = 4.dp)) {
                    Text(h.status.replaceFirstChar { it.uppercase() }, color = MaterialTheme.colorScheme.onSecondaryContainer, style = MaterialTheme.typography.labelMedium)
                }
            }

            // Teams
            if (teamOne.isNotEmpty() || teamTwo.isNotEmpty()) {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        TeamPanel(h.teamOneName, teamOne, accent, Modifier.weight(1f)) { name -> viewModel.movePlayer(eventId, historyId, name, toTeamTwo = true) }
                        TeamPanel(h.teamTwoName, teamTwo, MaterialTheme.colorScheme.tertiary, Modifier.weight(1f)) { name -> viewModel.movePlayer(eventId, historyId, name, toTeamTwo = false) }
                    }
                }
            }

            // ELO updates
            h.eloUpdates?.takeIf { it.isNotEmpty() }?.let { updates ->
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(stringResource(R.string.elo_changes), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                        updates.forEach { eu ->
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(eu.name, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                                Text("${if (eu.delta > 0) "+" else ""}${eu.delta}", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold,
                                    color = if (eu.delta > 0) MaterialTheme.colorScheme.primary else if (eu.delta < 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline)
                            }
                        }
                    }
                }
            }

            // Payments
            if (payments.isNotEmpty()) {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(stringResource(R.string.payments), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                        payments.forEachIndexed { index, p ->
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(p.name, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                                    p.amount?.let { Text(fmtMoney(it), color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.labelSmall) }
                                }
                                Box(
                                    Modifier.clip(RoundedCornerShape(50)).background(
                                        if (p.status == "paid") MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
                                    ).clickable { viewModel.togglePayment(eventId, historyId, index) }.padding(horizontal = 12.dp, vertical = 6.dp),
                                ) {
                                    Text(
                                        if (p.status == "paid") "\u2713 ${stringResource(R.string.paid)}" else stringResource(R.string.pending),
                                        color = if (p.status == "paid") MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.outline,
                                        style = MaterialTheme.typography.labelMedium,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable private fun ScoreColumn(name: String, score: Int?, color: androidx.compose.ui.graphics.Color, scoreSets: List<SetScore>?, teamOne: Boolean, modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(name, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.titleSmall, textAlign = TextAlign.Center)
        Spacer(Modifier.height(6.dp))
        val formattedSets = scoreSets.orEmpty().joinToString(" · ") { set ->
            val own = if (teamOne) set.teamOne else set.teamTwo
            val other = if (teamOne) set.teamTwo else set.teamOne
            if (set.tiebreakTeamOne != null && set.tiebreakTeamTwo != null) {
                val tbOwn = if (teamOne) set.tiebreakTeamOne else set.tiebreakTeamTwo
                val tbOther = if (teamOne) set.tiebreakTeamTwo else set.tiebreakTeamOne
                "$own-$other ($tbOwn-$tbOther)"
            } else "$own-$other"
        }
        Text(if (formattedSets.isNotEmpty()) formattedSets else "${score ?: "—"}", color = color, fontWeight = FontWeight.ExtraBold, style = if (formattedSets.isNotEmpty()) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.displayMedium, textAlign = TextAlign.Center)
    }
}

@Composable
internal fun TennisSetEditor(sets: List<SetScore>, onChange: (List<SetScore>) -> Unit) {
    fun updateSet(index: Int, update: (SetScore) -> SetScore) {
        onChange(sets.mapIndexed { i, set -> if (i == index) update(set) else set })
    }

    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        sets.forEachIndexed { index, set ->
            val hasTiebreak = set.tiebreakTeamOne != null && set.tiebreakTeamTwo != null
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Set ${index + 1}", modifier = Modifier.width(48.dp), style = MaterialTheme.typography.labelMedium)
                OutlinedTextField(
                    value = set.teamOne.toString(),
                    onValueChange = { value -> updateSet(index) { it.copy(teamOne = value.toIntOrNull()?.coerceAtLeast(0) ?: 0) } },
                    modifier = Modifier.width(72.dp),
                    singleLine = true,
                    label = { Text("Games 1") },
                )
                Text("-", fontWeight = FontWeight.Bold)
                OutlinedTextField(
                    value = set.teamTwo.toString(),
                    onValueChange = { value -> updateSet(index) { it.copy(teamTwo = value.toIntOrNull()?.coerceAtLeast(0) ?: 0) } },
                    modifier = Modifier.width(72.dp),
                    singleLine = true,
                    label = { Text("Games 2") },
                )
            }
            OutlinedButton(
                onClick = {
                    updateSet(index) {
                        if (hasTiebreak) it.copy(tiebreakTeamOne = null, tiebreakTeamTwo = null)
                        else it.copy(tiebreakTeamOne = 0, tiebreakTeamTwo = 0)
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (hasTiebreak) "Remove tiebreak" else "Add tiebreak")
            }
            if (hasTiebreak) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Tiebreak", modifier = Modifier.width(72.dp), style = MaterialTheme.typography.labelMedium)
                    OutlinedTextField(
                        value = set.tiebreakTeamOne.toString(),
                        onValueChange = { value -> updateSet(index) { it.copy(tiebreakTeamOne = value.toIntOrNull()?.coerceAtLeast(0) ?: 0) } },
                        modifier = Modifier.width(72.dp),
                        singleLine = true,
                        label = { Text("Points 1") },
                    )
                    Text("-", fontWeight = FontWeight.Bold)
                    OutlinedTextField(
                        value = set.tiebreakTeamTwo.toString(),
                        onValueChange = { value -> updateSet(index) { it.copy(tiebreakTeamTwo = value.toIntOrNull()?.coerceAtLeast(0) ?: 0) } },
                        modifier = Modifier.width(72.dp),
                        singleLine = true,
                        label = { Text("Points 2") },
                    )
                }
            }
        }
        Button(onClick = { onChange(sets + SetScore(0, 0)) }, enabled = sets.size < 5, modifier = Modifier.fillMaxWidth()) { Text("Add set") }
    }
}

@Composable private fun TeamPanel(name: String, members: List<TeamPlayer>, color: androidx.compose.ui.graphics.Color, modifier: Modifier = Modifier, onTap: (String) -> Unit = {}) {
    Column(modifier.clip(RoundedCornerShape(12.dp)).background(color.copy(alpha = 0.08f)).padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(name, color = color, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        members.forEach { p ->
            Box(Modifier.padding(vertical = 2.dp).clip(RoundedCornerShape(8.dp)).background(color.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 6.dp).clickable { onTap(p.name) }) {
                Text(p.name, color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

private fun fmtMoney(amount: Double): String = "\u20AC%.2f".format(amount)
