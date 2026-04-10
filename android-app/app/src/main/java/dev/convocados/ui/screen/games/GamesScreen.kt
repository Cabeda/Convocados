package dev.convocados.ui.screen.games

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import dev.convocados.data.api.EventSummary
import dev.convocados.data.api.MyGamesResponse
import dev.convocados.ui.theme.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import javax.inject.Inject

@HiltViewModel
class GamesViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _state = MutableStateFlow<GamesState>(GamesState.Loading)
    val state: StateFlow<GamesState> = _state

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.value = GamesState.Loading
            runCatching { api.fetchMyGames() }
                .onSuccess { _state.value = GamesState.Success(it) }
                .onFailure { _state.value = GamesState.Error(it.message ?: "Failed to load") }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            runCatching { api.fetchMyGames() }
                .onSuccess { _state.value = GamesState.Success(it) }
        }
    }
}

sealed class GamesState {
    data object Loading : GamesState()
    data class Success(val data: MyGamesResponse) : GamesState()
    data class Error(val message: String) : GamesState()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GamesScreen(
    onEventClick: (String) -> Unit,
    onCreateClick: () -> Unit,
    onPublicClick: () -> Unit,
    viewModel: GamesViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    var showArchived by remember { mutableStateOf(false) }
    var isRefreshing by remember { mutableStateOf(false) }

    Scaffold(
        floatingActionButton = {
            FloatingActionButton(onClick = onCreateClick, containerColor = Primary, contentColor = OnPrimary) {
                Icon(Icons.Default.Add, "Create game")
            }
        },
        containerColor = Bg,
    ) { padding ->
        when (val s = state) {
            is GamesState.Loading -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                CircularProgressIndicator(color = Primary)
            }
            is GamesState.Error -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(s.message, color = Error, fontSize = 14.sp)
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = { viewModel.load() }) { Text("Retry", color = Primary) }
                }
            }
            is GamesState.Success -> {
                val active = s.data.owned + s.data.joined
                val archived = s.data.archivedOwned + s.data.archivedJoined
                val games = if (showArchived) archived else active

                PullToRefreshBox(
                    isRefreshing = isRefreshing,
                    onRefresh = {
                        isRefreshing = true
                        viewModel.refresh()
                        isRefreshing = false
                    },
                    modifier = Modifier.fillMaxSize().padding(padding),
                ) {
                    LazyColumn(
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        // Tab bar
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 8.dp)) {
                                FilterChip(
                                    selected = !showArchived,
                                    onClick = { showArchived = false },
                                    label = { Text("My Games (${active.size})") },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = PrimaryDark,
                                        selectedLabelColor = PrimaryContainer,
                                    ),
                                )
                                if (archived.isNotEmpty()) {
                                    FilterChip(
                                        selected = showArchived,
                                        onClick = { showArchived = true },
                                        label = { Text("Archived (${archived.size})") },
                                        colors = FilterChipDefaults.filterChipColors(
                                            selectedContainerColor = PrimaryDark,
                                            selectedLabelColor = PrimaryContainer,
                                        ),
                                    )
                                }
                                FilterChip(
                                    selected = false,
                                    onClick = onPublicClick,
                                    label = { Text("\uD83C\uDF0D") },
                                )
                            }
                        }

                        if (games.isEmpty() && !showArchived) {
                            item {
                                Column(
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                ) {
                                    Text("No games yet", color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                                    Spacer(Modifier.height(8.dp))
                                    Text("Create a game or join one to get started.", color = TextMuted, fontSize = 14.sp)
                                    Spacer(Modifier.height(20.dp))
                                    Button(
                                        onClick = onCreateClick,
                                        colors = ButtonDefaults.buttonColors(containerColor = Primary),
                                    ) {
                                        Text("+ Create a Game", color = OnPrimary, fontWeight = FontWeight.Bold)
                                    }
                                }
                            }
                        }

                        items(games, key = { it.id }) { game ->
                            GameCard(game = game, onClick = { onEventClick(game.id) })
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun GameCard(game: EventSummary, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = Surface),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(game.title, color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Spacer(Modifier.height(4.dp))
            Text(
                "${formatRelativeDate(game.dateTime)} · ${game.playerCount}/${game.maxPlayers} players${if (game.isRecurring) " · \uD83D\uDD01" else ""}",
                color = TextSecondary, fontSize = 13.sp,
            )
            if (game.location.isNotBlank()) {
                Text(game.location, color = TextMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp), maxLines = 1)
            }
            if (game.archivedAt != null) {
                Text("ARCHIVED", color = TextMuted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

fun formatRelativeDate(iso: String): String = runCatching {
    val instant = Instant.parse(iso)
    val formatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withZone(ZoneId.systemDefault())
    formatter.format(instant)
}.getOrDefault(iso)
