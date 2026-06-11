package dev.convocados.ui.screen.courts

import androidx.compose.foundation.background
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.R
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.CourtWatch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CourtWatchesState(
    val loading: Boolean = true,
    val watches: List<CourtWatch> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class CourtWatchesViewModel @Inject constructor(
    private val api: ConvocadosApi,
) : ViewModel() {
    private val _state = MutableStateFlow(CourtWatchesState())
    val state: StateFlow<CourtWatchesState> = _state

    init { load() }

    private fun load() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true)
            runCatching { api.fetchCourtWatches() }
                .onSuccess { _state.value = CourtWatchesState(loading = false, watches = it.watches) }
                .onFailure { _state.value = CourtWatchesState(loading = false, error = it.message) }
        }
    }

    fun deleteWatch(id: String) {
        _state.value = _state.value.copy(watches = _state.value.watches.filter { it.id != id })
        viewModelScope.launch {
            runCatching { api.deleteCourtWatch(id) }
                .onFailure { load() } // reload on failure to restore
        }
    }
}

private val DAY_NAMES = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CourtWatchesScreen(
    onBack: () -> Unit,
    viewModel: CourtWatchesViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            TopAppBar(scrollBehavior = scrollBehavior, 
                title = { Text(stringResource(R.string.court_watches)) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } },
            )
        },
    ) { padding ->
        when {
            state.loading -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                CircularProgressIndicator()
            }
            state.error != null -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                Text(state.error!!, color = MaterialTheme.colorScheme.error)
            }
            state.watches.isEmpty() -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                Text(stringResource(R.string.no_court_watches), color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(32.dp))
            }
            else -> LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(state.watches, key = { it.id }) { watch ->
                    SwipeToDismissBox(
                        state = rememberSwipeToDismissBoxState(
                            confirmValueChange = { value ->
                                if (value == SwipeToDismissBoxValue.EndToStart) {
                                    viewModel.deleteWatch(watch.id)
                                    true
                                } else false
                            }
                        ),
                        backgroundContent = {
                            Box(
                                Modifier.fillMaxSize().background(MaterialTheme.colorScheme.errorContainer).padding(horizontal = 20.dp),
                                contentAlignment = Alignment.CenterEnd,
                            ) {
                                Icon(Icons.Default.Delete, stringResource(R.string.delete), tint = MaterialTheme.colorScheme.onErrorContainer)
                            }
                        },
                        enableDismissFromStartToEnd = false,
                    ) {
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(16.dp)) {
                                Text(watch.tenantName, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                Text(watch.resourceName, fontSize = 13.sp, color = MaterialTheme.colorScheme.outline)
                                Spacer(Modifier.height(4.dp))
                                val dayLabel = DAY_NAMES.getOrElse(watch.dayOfWeek - 1) { "?" }
                                Text(
                                    "$dayLabel · ${watch.startTime}–${watch.endTime}",
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
