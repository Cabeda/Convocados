package dev.convocados.ui.screen.games

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
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
import dev.convocados.data.repository.EventRepository
import dev.convocados.ui.theme.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import javax.inject.Inject

@HiltViewModel
class GamesViewModel @Inject constructor(
    private val repository: EventRepository,
    private val api: ConvocadosApi
) : ViewModel() {
    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing

    val ownedGames = repository.getEventsByType("owned")
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val joinedGames = repository.getEventsByType("joined")
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val archivedOwned = repository.getEventsByType("archivedOwned")
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val archivedJoined = repository.getEventsByType("archivedJoined")
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _refreshing.value = true
            repository.refreshMyGames()
            _refreshing.value = false
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalSharedTransitionApi::class)
@Composable
fun GamesScreen(
    onEventClick: (String) -> Unit,
    onCreateClick: () -> Unit,
    onPublicClick: () -> Unit,
    viewModel: GamesViewModel = hiltViewModel(),
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
) {
    val owned by viewModel.ownedGames.collectAsState()
    val joined by viewModel.joinedGames.collectAsState()
    val archivedOwned by viewModel.archivedOwned.collectAsState()
    val archivedJoined by viewModel.archivedJoined.collectAsState()
    val isRefreshing by viewModel.refreshing.collectAsState()
    var showArchived by remember { mutableStateOf(false) }

    Scaffold(
        floatingActionButton = {
            FloatingActionButton(onClick = onCreateClick, containerColor = Primary, contentColor = OnPrimary) {
                Icon(Icons.Default.Add, "Create game")
            }
        },
        containerColor = Bg,
    ) { padding ->
        val active = owned + joined
        val archived = archivedOwned + archivedJoined
        val games = if (showArchived) archived else active

        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { viewModel.refresh() },
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
                    GameCard(
                        game = game,
                        onClick = { onEventClick(game.id) },
                        sharedTransitionScope = sharedTransitionScope,
                        animatedVisibilityScope = animatedVisibilityScope,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun GameCard(
    game: EventSummary,
    onClick: () -> Unit,
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .then(
                with(sharedTransitionScope) {
                    Modifier.sharedElement(
                        rememberSharedContentState(key = "item-container-${game.id}"),
                        animatedVisibilityScope = animatedVisibilityScope
                    )
                }
            ),
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
