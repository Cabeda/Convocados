package dev.convocados.ui.screen.attendance

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import dev.convocados.R
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.AttendanceRecord
import dev.convocados.data.api.ConvocadosApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AttendanceViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _players = MutableStateFlow<List<AttendanceRecord>>(emptyList())
    val players: StateFlow<List<AttendanceRecord>> = _players
    private val _totalGames = MutableStateFlow(0)
    val totalGames: StateFlow<Int> = _totalGames
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading

    fun load(id: String) {
        viewModelScope.launch {
            _loading.value = true
            runCatching { api.fetchAttendance(id) }.onSuccess { _players.value = it.players; _totalGames.value = it.totalGames }
            _loading.value = false
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttendanceScreen(eventId: String, onBack: () -> Unit, viewModel: AttendanceViewModel = hiltViewModel()) {
    val players by viewModel.players.collectAsState()
    val totalGames by viewModel.totalGames.collectAsState()
    val loading by viewModel.loading.collectAsState()
    LaunchedEffect(eventId) { viewModel.load(eventId) }

    val accent = MaterialTheme.colorScheme.primary
    Scaffold(containerColor = MaterialTheme.colorScheme.background) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = accent) }; return@Scaffold }

        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(padding)) {
            item {
                Box(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                        .background(Brush.verticalGradient(listOf(accent.copy(alpha = 0.35f), MaterialTheme.colorScheme.surface)))
                        .padding(16.dp),
                ) {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = onBack, modifier = Modifier.size(36.dp)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
                        }
                        Text(stringResource(R.string.attendance), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                        Text(stringResource(R.string.games_played_total, totalGames), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            if (players.isEmpty()) {
                item { Box(Modifier.fillMaxWidth().padding(48.dp), Alignment.Center) { Text(stringResource(R.string.no_attendance_data), color = MaterialTheme.colorScheme.outline) } }
            }
            itemsIndexed(players, key = { _, p -> p.name }) { index, p ->
                val pct = (p.attendanceRate * 100).toInt()
                val heartColor = when {
                    pct >= 80 -> MaterialTheme.colorScheme.tertiary
                    pct >= 50 -> MaterialTheme.colorScheme.secondary
                    else -> MaterialTheme.colorScheme.error
                }
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("#${index + 1}", color = MaterialTheme.colorScheme.outline, fontWeight = FontWeight.Bold, modifier = Modifier.width(28.dp))
                        Column(Modifier.weight(1f)) {
                            Text(p.name, color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.titleSmall)
                            LinearProgressIndicator(
                                progress = { p.attendanceRate.toFloat() },
                                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).height(6.dp),
                                color = heartColor, trackColor = MaterialTheme.colorScheme.surfaceVariant,
                            )
                            Text(stringResource(R.string.games_streak_format, p.gamesPlayed, p.totalGames, p.currentStreak), color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.labelSmall)
                            p.lastPlayed?.let { lp ->
                                Text(stringResource(R.string.last_played, shortDate(lp)), color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.labelSmall)
                            }
                        }
                        Spacer(Modifier.width(10.dp))
                        Text("$pct%", color = heartColor, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                    }
                }
            }
        }
    }
}

private fun shortDate(iso: String): String {
    val d = runCatching { java.time.Instant.parse(iso).atZone(java.time.ZoneId.systemDefault()) }.getOrNull() ?: return iso
    return d.format(java.time.format.DateTimeFormatter.ofPattern("dd MMM"))
}
