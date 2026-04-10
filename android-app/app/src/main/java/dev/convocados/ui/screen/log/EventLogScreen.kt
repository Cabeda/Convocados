package dev.convocados.ui.screen.log

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.EventLogEntry
import dev.convocados.ui.screen.games.formatRelativeDate
import dev.convocados.ui.theme.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class EventLogViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _entries = MutableStateFlow<List<EventLogEntry>>(emptyList())
    val entries: StateFlow<List<EventLogEntry>> = _entries
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading
    private val _hasMore = MutableStateFlow(false)
    val hasMore: StateFlow<Boolean> = _hasMore
    private var cursor: String? = null

    fun load(id: String) {
        viewModelScope.launch {
            _loading.value = true
            runCatching { api.fetchEventLog(id) }.onSuccess {
                _entries.value = it.data; _hasMore.value = it.hasMore; cursor = it.nextCursor
            }
            _loading.value = false
        }
    }

    fun loadMore(id: String) {
        val c = cursor ?: return
        viewModelScope.launch {
            runCatching { api.fetchEventLog(id, c) }.onSuccess {
                _entries.value = _entries.value + it.data; _hasMore.value = it.hasMore; cursor = it.nextCursor
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventLogScreen(eventId: String, onBack: () -> Unit, viewModel: EventLogViewModel = hiltViewModel()) {
    val entries by viewModel.entries.collectAsState()
    val loading by viewModel.loading.collectAsState()
    val hasMore by viewModel.hasMore.collectAsState()
    LaunchedEffect(eventId) { viewModel.load(eventId) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("\uD83D\uDCCB Event Log") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg)) },
        containerColor = Bg,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = Primary) }; return@Scaffold }

        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(padding)) {
            if (entries.isEmpty()) {
                item { Box(Modifier.fillMaxWidth().padding(48.dp), Alignment.Center) { Text("No log entries yet", color = TextMuted) } }
            }
            items(entries, key = { it.id }) { entry ->
                Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            Text(entry.action, color = TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.weight(1f))
                            Text(formatRelativeDate(entry.createdAt), color = TextMuted, fontSize = 11.sp)
                        }
                        entry.actorName?.let { Text("by $it", color = TextSecondary, fontSize = 12.sp) }
                        entry.details?.let { Text(it, color = TextMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp)) }
                    }
                }
            }
            if (hasMore) {
                item {
                    TextButton(onClick = { viewModel.loadMore(eventId) }, modifier = Modifier.fillMaxWidth()) {
                        Text("Load more", color = Primary)
                    }
                }
            }
        }
    }
}
