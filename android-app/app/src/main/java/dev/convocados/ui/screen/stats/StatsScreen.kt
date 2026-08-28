package dev.convocados.ui.screen.stats

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import dev.convocados.R
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.PlayerStats
import dev.convocados.ui.components.StatTile
import dev.convocados.ui.theme.contentMaxWidthDp
import dev.convocados.ui.theme.layoutForWidthDp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class StatsViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _stats = MutableStateFlow<PlayerStats?>(null)
    val stats: StateFlow<PlayerStats?> = _stats
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    init { load() }

    fun load() {
        viewModelScope.launch {
            _loading.value = true
            runCatching { api.fetchMyStats() }
                .onSuccess { _stats.value = it; _error.value = null }
                .onFailure { _error.value = it.message }
            _loading.value = false
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsScreen(onEventClick: (String) -> Unit, viewModel: StatsViewModel = hiltViewModel()) {
    val stats by viewModel.stats.collectAsState()
    val loading by viewModel.loading.collectAsState()
    val error by viewModel.error.collectAsState()

    StatsContent(
        stats = stats,
        loading = loading,
        error = error,
        onRefresh = viewModel::load,
        onEventClick = onEventClick,
    )
}

/** Stateless stats renderer used by production and deterministic screenshot fixtures. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsContent(
    stats: PlayerStats?,
    loading: Boolean,
    error: String?,
    onRefresh: () -> Unit,
    onEventClick: (String) -> Unit,
) {
    var isRefreshing by remember { mutableStateOf(false) }

    LaunchedEffect(loading) {
        if (!loading) isRefreshing = false
    }

    if (loading && stats == null) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
        }
        return
    }
    if (error != null && stats == null) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Text(error, color = MaterialTheme.colorScheme.error)
        }
        return
    }
    val content = stats ?: return
    val layout = layoutForWidthDp(LocalConfiguration.current.screenWidthDp)

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = {
            isRefreshing = true
            onRefresh()
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .widthIn(max = contentMaxWidthDp(layout).dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 20.dp),
        ) {
            Text(
                stringResource(R.string.overview),
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.labelLarge,
                letterSpacing = 1.sp,
                modifier = Modifier.padding(bottom = 12.dp),
            )
            SummaryStats(content)

            if (content.events.isNotEmpty()) {
                Spacer(Modifier.height(24.dp))
                Text(
                    stringResource(R.string.per_event),
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.labelLarge,
                    letterSpacing = 1.sp,
                    modifier = Modifier.padding(bottom = 12.dp),
                )
                content.events.forEach { event ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                        shape = MaterialTheme.shapes.medium,
                        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 10.dp)
                            .clickable { onEventClick(event.eventId) },
                    ) {
                        Column(Modifier.padding(16.dp)) {
                            Text(
                                event.eventTitle,
                                color = MaterialTheme.colorScheme.onSurface,
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                stringResource(R.string.games_rating, event.gamesPlayed, event.rating),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.padding(top = 4.dp),
                            )
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                modifier = Modifier.padding(top = 8.dp),
                            ) {
                                Text("W${event.wins}", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
                                Text("D${event.draws}", color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.labelMedium)
                                Text("L${event.losses}", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium)
                            }
                            event.attendance?.let { attendance ->
                                Text(
                                    stringResource(R.string.attendance_streak, (attendance.attendanceRate * 100).toInt(), attendance.currentStreak),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.padding(top = 8.dp),
                                )
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun SummaryStats(stats: PlayerStats) {
    val summary = stats.summary
    val tiles = listOf(
        stringResource(R.string.games_stat) to summary.totalGames.toString(),
        stringResource(R.string.wins) to summary.totalWins.toString(),
        stringResource(R.string.draws) to summary.totalDraws.toString(),
        stringResource(R.string.losses) to summary.totalLosses.toString(),
        stringResource(R.string.win_rate) to "${(summary.winRate * 100).toInt()}%",
        stringResource(R.string.avg_rating) to summary.avgRating.toString(),
    )
    val rows = tiles.chunked(3)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        rows.forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { (label, value) ->
                    StatTile(label = label, value = value, modifier = Modifier.weight(1f))
                }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
fun StatBox(label: String, value: String, modifier: Modifier = Modifier) {
    StatTile(label = label, value = value, modifier = modifier)
}
