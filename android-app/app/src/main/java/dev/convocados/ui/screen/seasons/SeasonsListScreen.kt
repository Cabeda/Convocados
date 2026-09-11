package dev.convocados.ui.screen.seasons

import androidx.compose.foundation.clickable
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
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.SeasonSummary
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SeasonsListViewModel @Inject constructor(
    private val api: ConvocadosApi,
) : ViewModel() {
    private val _seasons = MutableStateFlow<List<SeasonSummary>>(emptyList())
    val seasons: StateFlow<List<SeasonSummary>> = _seasons
    private val _canManage = MutableStateFlow(false)
    val canManage: StateFlow<Boolean> = _canManage
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    fun load(eventId: String) {
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            runCatching { api.fetchSeasons(eventId) }
                .onSuccess { _seasons.value = it.seasons; _canManage.value = it.canManage }
                .onFailure { _error.value = it.message }
            _loading.value = false
        }
    }
}

private val TerminalStatuses = setOf("completed", "cancelled")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SeasonsListScreen(
    eventId: String,
    onBack: () -> Unit,
    onSeasonClick: (String) -> Unit,
    viewModel: SeasonsListViewModel = hiltViewModel(),
) {
    val seasons by viewModel.seasons.collectAsStateWithLifecycle()
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()

    LaunchedEffect(eventId) { viewModel.load(eventId) }

    val current = seasons.filter { it.status !in TerminalStatuses }
    val past = seasons.filter { it.status in TerminalStatuses }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.seasons)) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
                },
            )
        },
    ) { padding ->
        when {
            loading -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator() }
            error != null -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { Text(error!!, color = MaterialTheme.colorScheme.error) }
            seasons.isEmpty() -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { Text(stringResource(R.string.no_seasons), color = MaterialTheme.colorScheme.outline) }
            else -> LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxSize().padding(padding),
            ) {
                if (current.isNotEmpty()) {
                    item { SectionLabel(stringResource(R.string.seasons)) }
                    items(current, key = { it.id }) { season -> SeasonRow(season, onSeasonClick) }
                }
                if (past.isNotEmpty()) {
                    item { SectionLabel(stringResource(R.string.past_seasons)) }
                    items(past, key = { it.id }) { season -> SeasonRow(season, onSeasonClick) }
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
}

@Composable
private fun SeasonRow(season: SeasonSummary, onClick: (String) -> Unit) {
    Card(Modifier.fillMaxWidth().clickable { onClick(season.id) }) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(season.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            AssistChip(onClick = { onClick(season.id) }, label = { Text(statusLabel(season.status)) })
        }
    }
}

@Composable
private fun statusLabel(status: String): String = when (status) {
    "registration" -> stringResource(R.string.season_status_registration)
    "active" -> stringResource(R.string.season_status_active)
    "review" -> stringResource(R.string.season_status_review)
    "completed" -> stringResource(R.string.season_status_completed)
    "cancelled" -> stringResource(R.string.season_status_cancelled)
    else -> status
}
