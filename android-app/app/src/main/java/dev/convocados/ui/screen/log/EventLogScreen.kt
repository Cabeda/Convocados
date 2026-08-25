package dev.convocados.ui.screen.log

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
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

    val accent = MaterialTheme.colorScheme.primary
    Scaffold(containerColor = MaterialTheme.colorScheme.background) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = accent) }; return@Scaffold }

        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(padding)) {
            item {
                Box(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                        .background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(accent.copy(alpha = 0.35f), MaterialTheme.colorScheme.surface)))
                        .padding(16.dp),
                ) {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = onBack, modifier = Modifier.size(36.dp)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
                        }
                        Text(stringResource(R.string.event_log), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                        Text(stringResource(R.string.event_log_subtitle), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            if (entries.isEmpty()) {
                item { Box(Modifier.fillMaxWidth().padding(48.dp), Alignment.Center) { Text(stringResource(R.string.no_log_entries), color = MaterialTheme.colorScheme.outline) } }
            }
            items(entries, key = { it.id }) { entry ->
                val severity = logSeverity(entry.action)
                val icon = logIcon(entry.action)
                val tint = when (severity) {
                    LogSeverity.ERROR -> MaterialTheme.colorScheme.error
                    LogSeverity.WARNING -> MaterialTheme.colorScheme.secondary
                    LogSeverity.SUCCESS -> MaterialTheme.colorScheme.tertiary
                    else -> MaterialTheme.colorScheme.primary
                }
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(34.dp).clip(RoundedCornerShape(10.dp)).background(tint.copy(alpha = 0.12f)), Alignment.Center) {
                            Icon(icon, null, tint = tint, modifier = Modifier.size(18.dp))
                        }
                        Column(Modifier.weight(1f).padding(start = 10.dp)) {
                            Text(titleCase(entry.action), color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                            Text(formatRelativeDate(entry.createdAt), color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.labelSmall)
                            entry.actor?.let { Text(stringResource(R.string.by_actor, it), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) }
                        }
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

private enum class LogSeverity { INFO, SUCCESS, WARNING, ERROR }

private fun logSeverity(action: String): LogSeverity = when {
    action.contains("removed") || action.contains("cancelled") || action.contains("archived") || action.contains("cleared") -> LogSeverity.ERROR
    action.contains("claimed") || action.contains("relinquished") || action.contains("recurrence") || action.contains("unlocked") || action.contains("enabled") || action.contains("disabled") || action.contains("override") -> LogSeverity.WARNING
    action.contains("added") || action.contains("set") || action.contains("unarchived") -> LogSeverity.SUCCESS
    else -> LogSeverity.INFO
}

private fun logIcon(action: String) = when {
    action.contains("player") -> Icons.Default.Person
    action.contains("team") || action.contains("order") -> Icons.Default.List
    action.contains("cost") || action.contains("payment") -> Icons.Default.List
    action.contains("history") || action.contains("rating") -> Icons.Default.List
    action.contains("cancelled") || action.contains("archived") -> Icons.Default.Close
    action.contains("recurrence") -> Icons.Default.Refresh
    else -> Icons.Default.Settings
}

private fun titleCase(action: String): String =
    action.split("_").joinToString(" ") { w -> w.replaceFirstChar { it.titlecase() } }
