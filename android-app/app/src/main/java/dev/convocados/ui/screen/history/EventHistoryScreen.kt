package dev.convocados.ui.screen.history

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.GameHistory
import dev.convocados.ui.screen.games.formatRelativeDate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class EventHistoryViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _history = MutableStateFlow<List<GameHistory>>(emptyList())
    val history: StateFlow<List<GameHistory>> = _history
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading
    private val _hasMore = MutableStateFlow(false)
    val hasMore: StateFlow<Boolean> = _hasMore
    private var cursor: String? = null

    fun load(eventId: String) {
        viewModelScope.launch {
            _loading.value = true
            runCatching { api.fetchHistory(eventId) }.onSuccess {
                _history.value = it.data; _hasMore.value = it.hasMore; cursor = it.nextCursor
            }
            _loading.value = false
        }
    }

    fun loadMore(eventId: String) {
        val c = cursor ?: return
        viewModelScope.launch {
            runCatching { api.fetchHistory(eventId, c) }.onSuccess {
                _history.value = _history.value + it.data; _hasMore.value = it.hasMore; cursor = it.nextCursor
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventHistoryScreen(
    eventId: String,
    onBack: () -> Unit,
    onHistoryClick: (String) -> Unit,
    viewModel: EventHistoryViewModel = hiltViewModel(),
) {
    val history by viewModel.history.collectAsState()
    val loading by viewModel.loading.collectAsState()
    val hasMore by viewModel.hasMore.collectAsState()
    LaunchedEffect(eventId) { viewModel.load(eventId) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Game History") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator() }; return@Scaffold }

        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(padding)) {
            items(history, key = { it.id }) { h ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    modifier = Modifier.fillMaxWidth().clickable { onHistoryClick(h.id) },
                ) {
                    Column(Modifier.padding(14.dp)) {
                        Text(formatRelativeDate(h.dateTime), color = MaterialTheme.colorScheme.outline, fontSize = 12.sp)
                        if (h.scoreOne != null && h.scoreTwo != null) {
                            Text(
                                "${h.teamOneName} ${h.scoreOne} — ${h.scoreTwo} ${h.teamTwoName}",
                                fontWeight = FontWeight.Bold, fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.padding(top = 4.dp),
                            )
                        } else {
                            Text(h.status.replaceFirstChar { it.uppercase() }, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp, modifier = Modifier.padding(top = 4.dp))
                        }
                        h.eloUpdates?.takeIf { it.isNotEmpty() }?.let { updates ->
                            Row(modifier = Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                updates.take(4).forEach { eu ->
                                    Text("${eu.name} ${if (eu.delta > 0) "+" else ""}${eu.delta}",
                                        color = if (eu.delta > 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                                        fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                }
            }
            if (hasMore) {
                item { TextButton(onClick = { viewModel.loadMore(eventId) }, modifier = Modifier.fillMaxWidth()) { Text("Load more") } }
            }
        }
    }
}
