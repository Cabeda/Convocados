package dev.convocados.ui.screen.seasons

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
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
import dev.convocados.data.api.SeasonDetail
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
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    val busy by viewModel.busy.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(eventId, seasonId) { viewModel.load(eventId, seasonId) }
    LaunchedEffect(message) {
        message?.let { snackbarHostState.showSnackbar(it); viewModel.clearMessage() }
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
                    item { Text(stringResource(R.string.crew_league), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                    items(s.crews) { crew ->
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(14.dp)) {
                                Text(crew.name, fontWeight = FontWeight.Bold)
                                Text(crew.members.joinToString(", ") { it.name }, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                            }
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
