package dev.convocados.ui.screen.games

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
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

    val adminGames = repository.getEventsByType("admin")
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val followedGames = repository.getEventsByType("followed")
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val archivedOwned = repository.getEventsByType("archivedOwned")
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
    val admin by viewModel.adminGames.collectAsState()
    val followed by viewModel.followedGames.collectAsState()
    val archivedOwned by viewModel.archivedOwned.collectAsState()
    val isRefreshing by viewModel.refreshing.collectAsState()
    var showArchived by remember { mutableStateOf(false) }

    Scaffold(
        floatingActionButton = {
            FloatingActionButton(onClick = onCreateClick, containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary) {
                Icon(Icons.Default.Add, "Create game")
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        val active = owned + admin + followed
        val archived = archivedOwned
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
                                selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                                selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                            ),
                        )
                        if (archived.isNotEmpty()) {
                            FilterChip(
                                selected = showArchived,
                                onClick = { showArchived = true },
                                label = { Text("Archived (${archived.size})") },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                                    selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
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
                            Text("🏟️", fontSize = 48.sp)
                            Spacer(Modifier.height(12.dp))
                            Text("No games yet", style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurface)
                            Spacer(Modifier.height(8.dp))
                            Text("Create a game or join one to get started.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                            Spacer(Modifier.height(20.dp))
                            Button(
                                onClick = onCreateClick,
                                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                            ) {
                                Text("+ Create a Game", color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold)
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
    ElevatedCard(
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
        elevation = CardDefaults.elevatedCardElevation(defaultElevation = 2.dp),
        colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(sportEmoji(game.sport), fontSize = 22.sp, modifier = Modifier.padding(end = 10.dp))
                Text(game.title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
            }
            Spacer(Modifier.height(6.dp))
            Text(
                "${formatRelativeDate(game.dateTime)} · ${game.playerCount}/${game.maxPlayers} players${if (game.isRecurring) " · \uD83D\uDD01" else ""}",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (game.lastScoreOne != null && game.lastScoreTwo != null) {
                Text(
                    "${sportEmoji(game.sport)} ${game.lastScoreOne}:${game.lastScoreTwo}",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            if (game.location.isNotBlank()) {
                Text("\uD83D\uDCCD ${game.location}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(top = 4.dp), maxLines = 1)
            }
            if (game.archivedAt != null) {
                Text("ARCHIVED", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

fun sportEmoji(sport: String): String = when {
    sport.contains("football") || sport.contains("soccer") -> "⚽"
    sport.contains("futsal") -> "⚽"
    sport.contains("basketball") -> "🏀"
    sport.contains("volleyball") -> "🏐"
    sport.contains("tennis") -> "🎾"
    sport.contains("padel") -> "🏓"
    sport.contains("rugby") -> "🏉"
    sport.contains("handball") -> "🤾"
    sport.contains("hockey") -> "🏑"
    sport.contains("baseball") -> "⚾"
    sport.contains("cricket") -> "🏏"
    sport.isNotBlank() -> "🏅"
    else -> "🎯"
}

fun formatRelativeDate(iso: String): String = runCatching {
    val instant = Instant.parse(iso)
    val formatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withZone(ZoneId.systemDefault())
    formatter.format(instant)
}.getOrDefault(iso)
