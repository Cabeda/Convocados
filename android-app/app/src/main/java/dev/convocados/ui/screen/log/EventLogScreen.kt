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
import dev.convocados.data.api.EventLogEntry
import dev.convocados.ui.screen.games.formatRelativeDate
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
                _entries.value = it.entries; _hasMore.value = it.hasMore; cursor = it.nextCursor
            }
            _loading.value = false
        }
    }

    fun loadMore(id: String) {
        val c = cursor ?: return
        viewModelScope.launch {
            runCatching { api.fetchEventLog(id, c) }.onSuccess {
                _entries.value = _entries.value + it.entries; _hasMore.value = it.hasMore; cursor = it.nextCursor
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
        topBar = { TopAppBar(title = { Text("\uD83D\uDCCB ${stringResource(R.string.event_log)}") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background)) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = MaterialTheme.colorScheme.primary) }; return@Scaffold }

        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(padding)) {
            if (entries.isEmpty()) {
                item { Box(Modifier.fillMaxWidth().padding(48.dp), Alignment.Center) { Text(stringResource(R.string.no_log_entries), color = MaterialTheme.colorScheme.outline) } }
            }
            items(entries, key = { it.id }) { entry ->
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            Text(entry.action.replace("_", " "), color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                            Text(formatRelativeDate(entry.createdAt), color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.labelSmall)
                        }
                        entry.actor?.let { Text("by $it", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
            if (hasMore) {
                item {
                    TextButton(onClick = { viewModel.loadMore(eventId) }, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.load_more), color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
    }
}
