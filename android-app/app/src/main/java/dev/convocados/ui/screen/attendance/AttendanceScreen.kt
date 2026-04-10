package dev.convocados.ui.screen.attendance

import androidx.compose.foundation.layout.*
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
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.AttendanceRecord
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.ui.theme.*
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

    Scaffold(
        topBar = { TopAppBar(title = { Text("\uD83D\uDCC5 Attendance") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg)) },
        containerColor = Bg,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = Primary) }; return@Scaffold }

        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(padding)) {
            item { Text("$totalGames games played", color = TextMuted, fontSize = 13.sp, modifier = Modifier.padding(bottom = 8.dp)) }
            if (players.isEmpty()) {
                item { Box(Modifier.fillMaxWidth().padding(48.dp), Alignment.Center) { Text("No attendance data yet", color = TextMuted) } }
            }
            itemsIndexed(players, key = { _, p -> p.name }) { index, p ->
                val pct = (p.attendanceRate * 100).toInt()
                Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("#${index + 1}", color = TextMuted, fontWeight = FontWeight.Bold, modifier = Modifier.width(28.dp))
                        Column(Modifier.weight(1f)) {
                            Text(p.name, color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                            LinearProgressIndicator(
                                progress = { p.attendanceRate.toFloat() },
                                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).height(4.dp),
                                color = PrimaryDark, trackColor = SurfaceHover,
                            )
                            Text("${p.gamesPlayed}/${p.totalGames} games · streak: ${p.currentStreak}", color = TextMuted, fontSize = 11.sp)
                        }
                        Spacer(Modifier.width(10.dp))
                        Text("$pct%", color = when { pct >= 80 -> Success; pct >= 50 -> Primary; else -> Warning }, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
                    }
                }
            }
        }
    }
}
