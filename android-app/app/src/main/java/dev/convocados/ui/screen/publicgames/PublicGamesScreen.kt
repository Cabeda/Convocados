package dev.convocados.ui.screen.publicgames

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
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
import dev.convocados.data.api.PublicEvent
import dev.convocados.ui.screen.games.formatRelativeDate
import dev.convocados.ui.theme.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PublicGamesViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _events = MutableStateFlow<List<PublicEvent>>(emptyList())
    val events: StateFlow<List<PublicEvent>> = _events
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading
    private val _hasMore = MutableStateFlow(false)
    val hasMore: StateFlow<Boolean> = _hasMore
    private var cursor: String? = null

    init { load() }

    fun load() {
        viewModelScope.launch {
            _loading.value = true
            runCatching { api.fetchPublicEvents() }.onSuccess {
                _events.value = it.data; _hasMore.value = it.hasMore; cursor = it.nextCursor
            }
            _loading.value = false
        }
    }

    fun loadMore() {
        val c = cursor ?: return
        viewModelScope.launch {
            runCatching { api.fetchPublicEvents(c) }.onSuccess {
                _events.value = _events.value + it.data; _hasMore.value = it.hasMore; cursor = it.nextCursor
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalSharedTransitionApi::class)
@Composable
fun PublicGamesScreen(
    onEventClick: (String) -> Unit,
    onBack: () -> Unit,
    viewModel: PublicGamesViewModel = hiltViewModel(),
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
) {
    val events by viewModel.events.collectAsState()
    val loading by viewModel.loading.collectAsState()
    val hasMore by viewModel.hasMore.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("\uD83C\uDF0D Public Games") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg)) },
        containerColor = Bg,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = Primary) }; return@Scaffold }

        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(padding)) {
            if (events.isEmpty()) {
                item {
                    Column(Modifier.fillMaxWidth().padding(48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("No public games right now", color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Text("Create a game and make it public so others can find it.", color = TextMuted, fontSize = 14.sp)
                    }
                }
            }
            items(events, key = { it.id }) { event ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = Surface),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onEventClick(event.id) }
                        .then(
                            with(sharedTransitionScope) {
                                Modifier.sharedElement(
                                    rememberSharedContentState(key = "item-container-${event.id}"),
                                    animatedVisibilityScope = animatedVisibilityScope
                                )
                            }
                        )
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            Text(event.title, color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.weight(1f))
                            Card(colors = CardDefaults.cardColors(containerColor = if (event.spotsLeft == 0) ErrorBg else PrimaryDark)) {
                                Text(if (event.spotsLeft == 0) "Full" else "${event.spotsLeft} spots", color = if (event.spotsLeft == 0) ErrorText else PrimaryContainer, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
                            }
                        }
                        Text("${formatRelativeDate(event.dateTime)} · ${event.playerCount}/${event.maxPlayers} players", color = TextSecondary, fontSize = 13.sp)
                        if (event.location.isNotBlank()) Text("\uD83D\uDCCD ${event.location}", color = TextMuted, fontSize = 12.sp, maxLines = 1, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
            if (hasMore) {
                item { TextButton(onClick = { viewModel.loadMore() }, modifier = Modifier.fillMaxWidth()) { Text("Load more", color = Primary) } }
            }
        }
    }
}
