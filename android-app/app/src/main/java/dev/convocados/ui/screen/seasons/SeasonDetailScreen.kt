package dev.convocados.ui.screen.seasons

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.R
import dev.convocados.data.api.ApiException
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.CrewDraftInput
import dev.convocados.data.api.SeasonDetail
import dev.convocados.data.api.SeasonMemberCandidate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SeasonDetailViewModel @Inject constructor(
    private val api: ConvocadosApi,
) : ViewModel() {
    private val _season = MutableStateFlow<SeasonDetail?>(null)
    val season: StateFlow<SeasonDetail?> = _season
    private val _canManage = MutableStateFlow(false)
    val canManage: StateFlow<Boolean> = _canManage
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message
    private val _crewDrafts = MutableStateFlow<List<CrewDraftInput>>(emptyList())
    val crewDrafts: StateFlow<List<CrewDraftInput>> = _crewDrafts
    private val _candidates = MutableStateFlow<List<SeasonMemberCandidate>>(emptyList())
    val candidates: StateFlow<List<SeasonMemberCandidate>> = _candidates

    fun load(eventId: String, seasonId: String) {
        viewModelScope.launch {
            _loading.value = true
            runCatching { api.fetchEvent(eventId) }.onSuccess { _canManage.value = it.isAdmin }
            runCatching { api.fetchSeasonDetail(eventId, seasonId) }
                .onSuccess { _season.value = it.season }
                .onFailure { _message.value = if (it is ApiException && it.code == 403) null else it.message }
            _loading.value = false
        }
    }

    private fun action(eventId: String, seasonId: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            _busy.value = true
            runCatching { block() }.onSuccess { load(eventId, seasonId) }.onFailure { _message.value = it.message }
            _busy.value = false
        }
    }

    fun join(eventId: String, seasonId: String, eventPlayerId: String) =
        action(eventId, seasonId) { api.joinSeason(eventId, seasonId, eventPlayerId) }

    fun leave(eventId: String, seasonId: String) =
        action(eventId, seasonId) { api.leaveSeason(eventId, seasonId) }

    fun activate(eventId: String, seasonId: String) = action(eventId, seasonId) { api.activateSeason(eventId, seasonId) }
    fun complete(eventId: String, seasonId: String) = action(eventId, seasonId) { api.completeSeason(eventId, seasonId) }
    fun cancel(eventId: String, seasonId: String, reason: String?) = action(eventId, seasonId) { api.cancelSeason(eventId, seasonId, reason) }
    fun reopen(eventId: String, seasonId: String) = action(eventId, seasonId) { api.reopenSeason(eventId, seasonId) }

    fun bulkEnroll(eventId: String, seasonId: String) = action(eventId, seasonId) { api.bulkAddSeasonMembers(eventId, seasonId) }

    fun updateDetails(eventId: String, seasonId: String, name: String, opensAt: String, closesAt: String) =
        action(eventId, seasonId) { api.updateSeasonDetails(eventId, seasonId, name, opensAt, closesAt) }

    fun recommendCrews(eventId: String, seasonId: String, crewCount: Int) {
        viewModelScope.launch {
            _busy.value = true
            runCatching { api.recommendCrews(eventId, seasonId, crewCount) }
                .onSuccess { _crewDrafts.value = it.crews }
                .onFailure { _message.value = it.message }
            _busy.value = false
        }
    }

    fun saveCrews(eventId: String, seasonId: String) {
        viewModelScope.launch {
            _busy.value = true
            runCatching { api.saveCrews(eventId, seasonId, _crewDrafts.value) }
                .onSuccess { _crewDrafts.value = emptyList(); load(eventId, seasonId) }
                .onFailure { _message.value = it.message }
            _busy.value = false
        }
    }

    fun loadCandidates(eventId: String, seasonId: String) {
        viewModelScope.launch {
            runCatching { api.fetchSeasonCandidates(eventId, seasonId) }
                .onSuccess { _candidates.value = it.candidates }
                .onFailure { _message.value = it.message }
        }
    }

    fun addMember(eventId: String, seasonId: String, eventPlayerId: String) =
        action(eventId, seasonId) { api.addSeasonMember(eventId, seasonId, eventPlayerId) }

    fun removeMember(eventId: String, seasonId: String, membershipId: String) =
        action(eventId, seasonId) { api.removeSeasonMember(eventId, seasonId, membershipId) }

    fun clearMessage() { _message.value = null }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SeasonDetailScreen(
    eventId: String,
    seasonId: String,
    onBack: () -> Unit,
    viewModel: SeasonDetailViewModel = hiltViewModel(),
) {
    val season by viewModel.season.collectAsStateWithLifecycle()
    val canManage by viewModel.canManage.collectAsStateWithLifecycle()
    val crewDrafts by viewModel.crewDrafts.collectAsStateWithLifecycle()
    val candidates by viewModel.candidates.collectAsStateWithLifecycle()
    var showAdd by remember { mutableStateOf(false) }
    var crewCount by remember { mutableIntStateOf(2) }
    var showEdit by remember { mutableStateOf(false) }
    var editName by remember { mutableStateOf("") }
    var editOpens by remember { mutableStateOf("") }
    var editCloses by remember { mutableStateOf("") }
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    val busy by viewModel.busy.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(eventId, seasonId) { viewModel.load(eventId, seasonId) }
    LaunchedEffect(message) {
        message?.let { snackbarHostState.showSnackbar(it); viewModel.clearMessage() }
    }

    if (showAdd) {
        AlertDialog(
            onDismissRequest = { showAdd = false },
            title = { Text(stringResource(R.string.season_add_player)) },
            text = {
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    items(candidates, key = { it.eventPlayerId }) { candidate ->
                        Text(
                            candidate.name,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { viewModel.addMember(eventId, seasonId, candidate.eventPlayerId); showAdd = false }
                                .padding(vertical = 10.dp),
                        )
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showAdd = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }

    if (showEdit) {
        AlertDialog(
            onDismissRequest = { showEdit = false },
            title = { Text(stringResource(R.string.season_edit_details)) },
            text = {
                Column {
                    OutlinedTextField(value = editName, onValueChange = { editName = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(value = editOpens, onValueChange = { editOpens = it }, label = { Text("Opens (YYYY-MM-DD)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(value = editCloses, onValueChange = { editCloses = it }, label = { Text("Closes (YYYY-MM-DD)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                TextButton(onClick = { viewModel.updateDetails(eventId, seasonId, editName, editOpens, editCloses); showEdit = false }) { Text(stringResource(R.string.save)) }
            },
            dismissButton = { TextButton(onClick = { showEdit = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(season?.name ?: stringResource(R.string.seasons)) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } },
            )
        },
    ) { padding ->
        val s = season
        when {
            loading -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator() }
            s == null -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { Text(stringResource(R.string.no_seasons), color = MaterialTheme.colorScheme.outline) }
            else -> LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize().padding(padding),
            ) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(s.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
                        AssistChip(onClick = {}, label = { Text(s.status) })
                    }
                }

                // Membership
                if (s.status == "registration" && s.viewerEventPlayerId != null) {
                    item {
                        val isMember = s.viewerMembership?.status == "active"
                        Button(
                            onClick = { if (isMember) viewModel.leave(eventId, seasonId) else viewModel.join(eventId, seasonId, s.viewerEventPlayerId!!) },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(stringResource(if (isMember) R.string.season_leave else R.string.season_join)) }
                    }
                }

                // Crew league
                val crews = s.leaderboard?.crews ?: emptyList()
                if (crews.isNotEmpty()) {
                    item { Text(stringResource(R.string.crew_league), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                    items(crews, key = { it.crewId }) { crew ->
                        Card(Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("${crew.rank}", color = MaterialTheme.colorScheme.outline, fontWeight = FontWeight.Bold, modifier = Modifier.width(24.dp))
                                Text(crew.name, modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                                Text(String.format("%.2f", crew.points), fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.primary)
                            }
                        }
                    }
                }

                // Crews (members)
                if (s.crews.isNotEmpty()) {
                    item { Text(stringResource(R.string.crews), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                    items(s.crews) { crew ->
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(14.dp)) {
                                Text(crew.name, fontWeight = FontWeight.Bold)
                                Text(crew.members.joinToString(", ") { it.name }, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }

                // Members
                if (s.activeMembers.isNotEmpty()) {
                    item { Text(stringResource(R.string.season_members), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                    items(s.activeMembers, key = { it.membershipId }) { member ->
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(member.name, modifier = Modifier.weight(1f))
                            if (canManage && s.status != "completed" && s.status != "cancelled") {
                                IconButton(onClick = { viewModel.removeMember(eventId, seasonId, member.membershipId) }, enabled = !busy) {
                                    Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(20.dp))
                                }
                            }
                        }
                    }
                }

                // Admin setup (registration only)
                if (canManage && s.status == "registration") {
                    item { Text(stringResource(R.string.season_manage), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { viewModel.bulkEnroll(eventId, seasonId) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                                Text(stringResource(R.string.season_enroll_recent))
                            }
                            OutlinedButton(onClick = { viewModel.loadCandidates(eventId, seasonId); showAdd = true }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                                Text(stringResource(R.string.season_add_player))
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(stringResource(R.string.crews) + ": $crewCount", modifier = Modifier.weight(1f))
                                OutlinedButton(onClick = { if (crewCount > 2) crewCount-- }, enabled = !busy) { Text("\u2212") }
                                Spacer(Modifier.width(8.dp))
                                OutlinedButton(onClick = { crewCount++ }, enabled = !busy) { Text("+") }
                            }
                            Button(onClick = { viewModel.recommendCrews(eventId, seasonId, crewCount) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                                Text(stringResource(R.string.season_recommend_crews))
                            }
                            crewDrafts.forEach { draft ->
                                Text("${draft.name} \u00B7 ${draft.membershipIds.size}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                            }
                            if (crewDrafts.isNotEmpty()) {
                                Button(onClick = { viewModel.saveCrews(eventId, seasonId) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                                    Text(stringResource(R.string.season_save_crews))
                                }
                            }
                            OutlinedButton(
                                onClick = {
                                    editName = s.name
                                    editOpens = s.registrationOpensAt.take(10)
                                    editCloses = s.registrationClosesAt.take(10)
                                    showEdit = true
                                },
                                enabled = !busy,
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text(stringResource(R.string.season_edit_details)) }
                        }
                    }
                }

                // Admin lifecycle
                if (canManage) {
                    item { Text(stringResource(R.string.season_manage), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            when (s.status) {
                                "registration" -> Button(onClick = { viewModel.activate(eventId, seasonId) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.season_activate)) }
                                "active", "review" -> Button(onClick = { viewModel.complete(eventId, seasonId) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.season_complete)) }
                                "completed" -> Button(onClick = { viewModel.reopen(eventId, seasonId) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.season_reopen)) }
                            }
                            if (s.status != "completed" && s.status != "cancelled") {
                                OutlinedButton(onClick = { viewModel.cancel(eventId, seasonId, null) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.season_cancel), color = MaterialTheme.colorScheme.error) }
                            }
                        }
                    }
                }
            }
        }
    }
}
