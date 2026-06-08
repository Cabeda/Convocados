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
import dev.convocados.data.api.PlayerStats
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
    var isRefreshing by remember { mutableStateOf(false) }

    if (loading) {
        Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = MaterialTheme.colorScheme.primary) }
        return
    }
    if (error != null || stats == null) {
        Box(Modifier.fillMaxSize(), Alignment.Center) { Text(error ?: "Something went wrong", color = MaterialTheme.colorScheme.error) }
        return
    }

    val s = stats!!.summary
    PullToRefreshBox(isRefreshing = isRefreshing, onRefresh = { isRefreshing = true; viewModel.load(); isRefreshing = false }, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
            Text(stringResource(R.string.overview), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold, fontSize = 14.sp, letterSpacing = 1.sp)
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatBox("Games", "${s.totalGames}", Modifier.weight(1f))
                StatBox("Wins", "${s.totalWins}", Modifier.weight(1f))
                StatBox("Draws", "${s.totalDraws}", Modifier.weight(1f))
            }
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatBox("Losses", "${s.totalLosses}", Modifier.weight(1f))
                StatBox("Win Rate", "${(s.winRate * 100).toInt()}%", Modifier.weight(1f))
                StatBox("Avg Rating", "${s.avgRating}", Modifier.weight(1f))
            }

            if (stats!!.events.isNotEmpty()) {
                Spacer(Modifier.height(20.dp))
                Text(stringResource(R.string.per_event), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold, fontSize = 14.sp, letterSpacing = 1.sp)
                Spacer(Modifier.height(12.dp))
                stats!!.events.forEach { ev ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).clickable { onEventClick(ev.eventId) },
                    ) {
                        Column(Modifier.padding(14.dp)) {
                            Text(ev.eventTitle, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                            Text("${ev.gamesPlayed} games · Rating: ${ev.rating}", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                                Text("W${ev.wins}", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                Text("D${ev.draws}", color = MaterialTheme.colorScheme.outline, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                Text("L${ev.losses}", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                            }
                            ev.attendance?.let { att ->
                                Text("Attendance: ${(att.attendanceRate * 100).toInt()}% · Streak: ${att.currentStreak}", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
fun StatBox(label: String, value: String, modifier: Modifier = Modifier) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = modifier) {
        Column(Modifier.padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, color = MaterialTheme.colorScheme.onSurface, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
            Text(label, color = MaterialTheme.colorScheme.outline, fontSize = 11.sp)
        }
    }
}
