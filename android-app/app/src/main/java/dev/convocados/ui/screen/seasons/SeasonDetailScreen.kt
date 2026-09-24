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
import dev.convocados.data.api.CrewProposal
import dev.convocados.data.api.CrewProposalCandidate
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
    private val _proposals = MutableStateFlow<List<CrewProposal>>(emptyList())
    val proposals: StateFlow<List<CrewProposal>> = _proposals
    private val _proposalCandidates = MutableStateFlow<List<CrewProposalCandidate>>(emptyList())
    val proposalCandidates: StateFlow<List<CrewProposalCandidate>> = _proposalCandidates
    private val _canPropose = MutableStateFlow(false)
    val canPropose: StateFlow<Boolean> = _canPropose
    private val _canReview = MutableStateFlow(false)
    val canReview: StateFlow<Boolean> = _canReview
    private val _proposerMembershipId = MutableStateFlow<String?>(null)
    val proposerMembershipId: StateFlow<String?> = _proposerMembershipId

    fun load(eventId: String, seasonId: String) {
        viewModelScope.launch {
            _loading.value = true
            runCatching { api.fetchEvent(eventId) }.onSuccess { _canManage.value = it.isAdmin }
            runCatching { api.fetchSeasonDetail(eventId, seasonId) }
                .onSuccess { _season.value = it.season }
                .onFailure { _message.value = if (it is ApiException && it.code == 403) null else it.message }
            loadProposals(eventId, seasonId)
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

    private suspend fun loadProposals(eventId: String, seasonId: String) {
        runCatching { api.fetchCrewProposals(eventId, seasonId) }
            .onSuccess {
                _proposals.value = it.proposals
                _proposalCandidates.value = it.candidates
                _canPropose.value = it.canPropose
                _canReview.value = it.canReview
                _proposerMembershipId.value = it.proposerMembershipId
            }
    }

    fun submitProposal(eventId: String, seasonId: String, name: String, membershipIds: List<String>) {
        viewModelScope.launch {
            _busy.value = true
            runCatching { api.submitCrewProposal(eventId, seasonId, name, membershipIds) }
                .onSuccess { loadProposals(eventId, seasonId) }
                .onFailure { _message.value = it.message }
            _busy.value = false
        }
    }

    fun decideProposal(eventId: String, seasonId: String, proposalId: String, decision: String, rejectionReason: String? = null) {
        viewModelScope.launch {
            _busy.value = true
            runCatching { api.decideCrewProposal(eventId, seasonId, proposalId, decision, rejectionReason) }
                .onSuccess { load(eventId, seasonId) }
                .onFailure { _message.value = it.message }
            _busy.value = false
        }
    }

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
    val proposals by viewModel.proposals.collectAsStateWithLifecycle()
    val proposalCandidates by viewModel.proposalCandidates.collectAsStateWithLifecycle()
    val canPropose by viewModel.canPropose.collectAsStateWithLifecycle()
    val canReview by viewModel.canReview.collectAsStateWithLifecycle()
    var showPropose by remember { mutableStateOf(false) }
    var proposalName by remember { mutableStateOf("") }
    val selectedMembers = remember { mutableStateListOf<String>() }
    val showProposals = canPropose || canReview || proposals.isNotEmpty()
    var rejectingId by remember { mutableStateOf<String?>(null) }
    var rejectionReason by remember { mutableStateOf("") }
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    val busy by viewModel.busy.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(eventId, seasonId) { viewModel.load(eventId, seasonId) }
    LaunchedEffect(message) {
        message?.let { snackbarHostState.showSnackbar(it); viewModel.clearMessage() }
    }

    if (showPropose) {
        AlertDialog(
            onDismissRequest = { showPropose = false },
            title = { Text(stringResource(R.string.propose_crew)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.propose_crew_description), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(
                        value = proposalName,
                        onValueChange = { proposalName = it },
                        label = { Text(stringResource(R.string.crew_proposal_name)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(stringResource(R.string.select_crew_members), style = MaterialTheme.typography.labelMedium)
                    LazyColumn(Modifier.heightIn(max = 240.dp)) {
                        items(proposalCandidates, key = { it.membershipId ?: it.userId ?: it.name }) { candidate ->
                            val id = candidate.membershipId
                            val selectable = id != null
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Checkbox(
                                    checked = id != null && selectedMembers.contains(id),
                                    onCheckedChange = { checked ->
                                        if (id == null) return@Checkbox
                                        if (checked) { if (selectedMembers.size < 5) selectedMembers.add(id) }
                                        else selectedMembers.remove(id)
                                    },
                                    enabled = selectable,
                                )
                                Text(candidate.name, modifier = Modifier.weight(1f))
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.submitProposal(eventId, seasonId, proposalName.trim(), selectedMembers.toList())
                        showPropose = false
                    },
                    enabled = !busy && proposalName.isNotBlank() && selectedMembers.size in 3..5,
                ) { Text(stringResource(R.string.submit_crew_proposal)) }
            },
            dismissButton = { TextButton(onClick = { showPropose = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }

    if (rejectingId != null) {
        AlertDialog(
            onDismissRequest = { rejectingId = null; rejectionReason = "" },
            title = { Text(stringResource(R.string.reject_proposal)) },
            text = {
                OutlinedTextField(
                    value = rejectionReason,
                    onValueChange = { rejectionReason = it },
                    label = { Text(stringResource(R.string.rejection_reason)) },
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val id = rejectingId ?: return@TextButton
                    viewModel.decideProposal(eventId, seasonId, id, "reject", rejectionReason.trim().ifBlank { null })
                    rejectingId = null; rejectionReason = ""
                }) { Text(stringResource(R.string.reject_proposal)) }
            },
            dismissButton = { TextButton(onClick = { rejectingId = null; rejectionReason = "" }) { Text(stringResource(R.string.cancel)) } },
        )
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
                            onClick = { if (isMember) viewModel.leave(eventId, seasonId) else viewModel.join(eventId, seasonId, s.viewerEventPlayerId) },
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

                // Crew proposals (web parity, GH #923)
                if (showProposals && s.status == "registration") {
                    item { Text(stringResource(R.string.crew_proposals), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }

                    if (canReview && proposals.any { it.status == "pending" }) {
                        item { Text(stringResource(R.string.crew_proposal_review_queue), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary) }
                        items(proposals.filter { it.status == "pending" }, key = { it.id }) { proposal ->
                            Card(Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(proposal.name, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                        AssistChip(onClick = {}, label = { Text(stringResource(R.string.proposal_status_pending)) })
                                    }
                                    Text(proposal.memberNames.joinToString(", "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Button(onClick = { viewModel.decideProposal(eventId, seasonId, proposal.id, "approve") }, enabled = !busy) {
                                            Text(stringResource(R.string.approve_proposal))
                                        }
                                        OutlinedButton(onClick = { rejectingId = proposal.id }, enabled = !busy) {
                                            Text(stringResource(R.string.reject_proposal))
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (proposals.isNotEmpty()) {
                        item { Text(stringResource(R.string.your_crew_proposals), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary) }
                        items(proposals, key = { it.id }) { proposal ->
                            Card(Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(proposal.name, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                                        AssistChip(onClick = {}, label = { Text(statusLabel(proposal.status)) })
                                    }
                                    Text(stringResource(R.string.proposal_proposed_by, proposal.proposerName), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(proposal.memberNames.joinToString(", "), style = MaterialTheme.typography.bodySmall)
                                    proposal.rejectionReason?.takeIf { it.isNotBlank() }?.let {
                                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                                    }
                                }
                            }
                        }
                    }

                    if (canPropose && proposalCandidates.isNotEmpty()) {
                        item {
                            OutlinedButton(onClick = { selectedMembers.clear(); proposalName = ""; showPropose = true }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                                Text(stringResource(R.string.propose_crew))
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

@Composable
private fun statusLabel(status: String): String = when (status) {
    "approved" -> stringResource(R.string.proposal_status_approved)
    "rejected" -> stringResource(R.string.proposal_status_rejected)
    else -> stringResource(R.string.proposal_status_pending)
}
