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
import androidx.compose.ui.platform.testTag
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
import androidx.compose.material.icons.filled.SportsSoccer
import androidx.compose.material.icons.filled.SportsBasketball
import androidx.compose.material.icons.filled.SportsVolleyball
import androidx.compose.material.icons.filled.SportsTennis
import androidx.compose.material.icons.filled.SportsRugby
import androidx.compose.material.icons.filled.SportsHandball
import androidx.compose.material.icons.filled.SportsHockey
import androidx.compose.material.icons.filled.SportsBaseball
import androidx.compose.material.icons.filled.SportsCricket
import androidx.compose.material.icons.filled.SportsMartialArts
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Stadium
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon

@HiltViewModel
class GamesViewModel @Inject constructor(
    private val repository: EventRepository,
    private val api: ConvocadosApi,
    private val tokenStore: dev.convocados.data.auth.TokenStore,
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

    fun archive(eventId: String) {
        viewModelScope.launch { repository.archiveEvent(eventId) }
    }

    fun unarchive(eventId: String) {
        viewModelScope.launch { repository.unarchiveEvent(eventId) }
    }

    fun shareUrl(eventId: String): String = "${tokenStore.getServerUrl()}/events/$eventId"
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalSharedTransitionApi::class)
@Composable
fun GamesScreen(
    onEventClick: (String) -> Unit,
    onCreateClick: () -> Unit,
    onPublicClick: () -> Unit,
    onOpenSettings: (String) -> Unit = {},
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
            FloatingActionButton(onClick = onCreateClick, containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.testTag("create_game_fab")) {
                Icon(Icons.Default.Add, stringResource(R.string.create_game_button))
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        val active = owned + admin + followed
        val archived = archivedOwned
        val games = if (showArchived) archived else active

        Column(Modifier.fillMaxSize().padding(padding)) {
            // Fixed tab header — stays visible while content scrolls.
            // SecondaryScrollableTabRow adapts: scrollable when tabs overflow,
            // fills width otherwise. Better than chips that clip on small screens.
            val tabIndex = if (showArchived) 1 else 0
            SecondaryScrollableTabRow(
                selectedTabIndex = tabIndex,
                edgePadding = 16.dp,
                containerColor = MaterialTheme.colorScheme.background,
                divider = {},
            ) {
                Tab(
                    selected = tabIndex == 0,
                    onClick = { showArchived = false },
                    text = { Text("${stringResource(R.string.my_games)} (${active.size})") },
                )
                if (archived.isNotEmpty()) {
                    Tab(
                        selected = tabIndex == 1,
                        onClick = { showArchived = true },
                        text = { Text("${stringResource(R.string.archived)} (${archived.size})") },
                    )
                }
                Tab(
                    selected = false,
                    onClick = onPublicClick,
                    text = { Text(stringResource(R.string.public_label)) },
                    icon = { Icon(Icons.Default.Public, null, modifier = Modifier.size(18.dp)) },
                )
            }

            PullToRefreshBox(
                isRefreshing = isRefreshing,
                onRefresh = { viewModel.refresh() },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {

                if (games.isEmpty() && showArchived) {
                    item {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Icon(Icons.Default.Archive, contentDescription = null, modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(12.dp))
                            Text(stringResource(R.string.no_archived_games), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                        }
                    }
                }

                if (games.isEmpty() && !showArchived) {
                    item {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Icon(Icons.Default.Stadium, contentDescription = null, modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(12.dp))
                            Text(stringResource(R.string.no_games_yet), style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurface)
                            Spacer(Modifier.height(8.dp))
                            Text(stringResource(R.string.no_games_desc), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                            Spacer(Modifier.height(20.dp))
                            Button(
                                onClick = onCreateClick,
                                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                            ) {
                                Text(stringResource(R.string.create_a_game), color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }

                items(games, key = { it.id }) { game ->
                    val ctx = LocalContext.current
                    GameCard(
                        game = game,
                        onClick = { onEventClick(game.id) },
                        onOpenSettings = { onOpenSettings(game.id) },
                        onArchiveToggle = {
                            if (game.archivedAt != null) viewModel.unarchive(game.id) else viewModel.archive(game.id)
                        },
                        onShare = {
                            val text = "${game.title}\n${formatRelativeDate(game.dateTime)}" +
                                (if (game.location.isNotBlank()) "\n${game.location}" else "") +
                                "\n\n${viewModel.shareUrl(game.id)}"
                            ctx.startActivity(
                                android.content.Intent.createChooser(
                                    android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                                        type = "text/plain"; putExtra(android.content.Intent.EXTRA_TEXT, text)
                                    },
                                    null,
                                )
                            )
                        },
                        sharedTransitionScope = sharedTransitionScope,
                        animatedVisibilityScope = animatedVisibilityScope,
                    )
                }
            }
        }  // PullToRefreshBox
        }  // Column
    }
}

@OptIn(ExperimentalSharedTransitionApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun GameCard(
    game: EventSummary,
    onClick: () -> Unit,
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
    onOpenSettings: () -> Unit = {},
    onArchiveToggle: () -> Unit = {},
    onShare: () -> Unit = {},
) {
    var menuOpen by remember { mutableStateOf(false) }
    ElevatedCard(
        modifier = Modifier
            .fillMaxWidth()
            .testTag("game_card_${game.id}")
            .combinedClickable(
                onClick = onClick,
                onLongClick = { menuOpen = true },
                onLongClickLabel = stringResource(R.string.quick_actions),
            )
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
                SportIcon(game.sport, modifier = Modifier.size(24.dp).padding(end = 2.dp))
                Spacer(Modifier.width(8.dp))
                Text(game.title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f))
            }
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(R.string.event_meta, formatRelativeDate(game.dateTime), game.playerCount, game.maxPlayers) + (if (game.isRecurring) stringResource(R.string.recurring_suffix) else ""),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (game.lastScoreOne != null && game.lastScoreTwo != null) {
                Text(
                    stringResource(R.string.last_score, game.lastScoreOne!!, game.lastScoreTwo!!),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            if (game.location.isNotBlank()) {
                Text(game.location, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(top = 4.dp), maxLines = 1)
            }
            if (game.archivedAt != null) {
                Text(stringResource(R.string.archived_label), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp))
            }
        }

        // Long-press quick actions
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.open_settings)) },
                leadingIcon = { Icon(Icons.Default.Settings, null) },
                onClick = { menuOpen = false; onOpenSettings() },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.share)) },
                leadingIcon = { Icon(Icons.Default.Share, null) },
                onClick = { menuOpen = false; onShare() },
            )
            DropdownMenuItem(
                text = { Text(stringResource(if (game.archivedAt != null) R.string.unarchive_game else R.string.archive_game)) },
                leadingIcon = { Icon(if (game.archivedAt != null) Icons.Default.Unarchive else Icons.Default.Archive, null) },
                onClick = { menuOpen = false; onArchiveToggle() },
            )
        }
    }
}

@Composable
fun SportIcon(sport: String, modifier: Modifier = Modifier, tint: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.primary) {
    val icon = when {
        sport.contains("football") || sport.contains("soccer") || sport.contains("futsal") -> Icons.Default.SportsSoccer
        sport.contains("basketball") -> Icons.Default.SportsBasketball
        sport.contains("volleyball") -> Icons.Default.SportsVolleyball
        sport.contains("tennis") || sport.contains("padel") -> Icons.Default.SportsTennis
        sport.contains("rugby") -> Icons.Default.SportsRugby
        sport.contains("handball") -> Icons.Default.SportsHandball
        sport.contains("hockey") -> Icons.Default.SportsHockey
        sport.contains("baseball") -> Icons.Default.SportsBaseball
        sport.contains("cricket") -> Icons.Default.SportsCricket
        else -> Icons.Default.SportsMartialArts
    }
    Icon(icon, contentDescription = sport, modifier = modifier, tint = tint)
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
