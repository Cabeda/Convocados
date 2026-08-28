package dev.convocados.wear.ui.screen.games

import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.compose.foundation.layout.*
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.*
import androidx.wear.compose.material3.lazy.rememberTransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight
import dev.convocados.wear.R
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.ui.theme.expressiveTokens
import dev.convocados.wear.util.PullToRefreshProgress
import dev.convocados.wear.util.formatRelativeTime

@Composable
fun GamesScreen(
    viewModel: GamesViewModel,
    onGameSelected: (String) -> Unit,
    onSignOut: () -> Unit,
    onQuickGame: () -> Unit = {},
    onHistory: () -> Unit = {},
    continueQuickGame: Boolean = false,
    onContinueQuickGame: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()
    val isOnline = rememberNetworkAvailable()
    val tokens = expressiveTokens()
    val showOfflineBanner = shouldShowOfflineGamesBanner(state.isOffline, isOnline)

    // Auto-navigate to the scorable suggested game on first load
    val autoNavId = state.autoNavigateEventId
    LaunchedEffect(autoNavId) {
        if (autoNavId != null) {
            onGameSelected(autoNavId)
            viewModel.consumeAutoNavigate()
        }
    }

    // Auto-refresh when returning to this screen (VM survives the detour), so
    // the list picks up updates after the user was elsewhere — silently
    // degrades to cached data when there is no internet.
    LaunchedEffect(Unit) {
        viewModel.onScreenEntered()
    }

    val columnState = rememberTransformingLazyColumnState()
    val transformationSpec = rememberTransformationSpec()

    val visiblePastGames = remember(state.pastGames, state.visiblePastCount) {
        state.pastGames.take(state.visiblePastCount)
    }

    // Pull-down at the top triggers a refresh. Expressive M3 feel: finger
    // travel is resisted (so a deliberate pull is needed), the indicator fills
    // with the pull distance, and it springs back on release / into refresh.
    //
    // Progress accumulates across gestures so a user who pulls in short bursts
    // still reaches the threshold — the Wear screen is too small to cover the
    // whole distance in a single pull.
    val density = LocalDensity.current
    val pullProgressState = remember(viewModel) {
        PullToRefreshProgress(
            threshold = with(density) { 48.dp.toPx() },
            resistance = 0.75f,
        )
    }
    var pullProgress by remember { mutableFloatStateOf(0f) }
    var refreshing by remember { mutableStateOf(false) }
    val pullToRefresh = remember(viewModel) {
        object : NestedScrollConnection {
            // Read the raw overscroll in onPreScroll, BEFORE the TransformingLazyColumn
            // consumes it for its stretch animation. The column reports only a fraction
            // of the finger travel as leftover (available.y) in onPostScroll, so counting
            // there made the indicator barely fill and the trigger nearly unreachable.
            // We observe (return Zero) so the column's own physics are untouched.
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                val dy = available.y
                if (dy > 0f && !columnState.canScrollBackward) {
                    if (pullProgressState.onScroll(dy) && !refreshing) {
                        refreshing = true
                        viewModel.refresh()
                    }
                    pullProgress = pullProgressState.progress()
                } else if (dy < 0f) {
                    pullProgressState.reset()
                    pullProgress = 0f
                }
                return Offset.Zero
            }
        }
    }
    // Progress is deliberately NOT reset when the finger lifts before reaching
    // the threshold: a user who pulls in short bursts ("pull, pull, pull") still
    // gets their first deliberate refresh, and progress only resets when the
    // scroll goes back up or the refresh completes.
    LaunchedEffect(state.isLoading) {
        if (!state.isLoading) {
            refreshing = false
            pullProgressState.reset()
            pullProgress = 0f
        }
    }

    // Expressive spring drives the displayed indicator (bouncy snap-back).
    val springSpec = spring<Float>(
        dampingRatio = Spring.DampingRatioMediumBouncy,
        stiffness = Spring.StiffnessMediumLow,
    )
    val displayedPull by animateFloatAsState(
        targetValue = if (refreshing) 1f else pullProgress,
        animationSpec = springSpec,
        label = "pullIndicator",
    )

    ScreenScaffold(scrollState = columnState) { contentPadding ->
        when {
            state.isLoading && state.games.isEmpty() -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            state.games.isEmpty() && state.pastGames.isEmpty() -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(horizontal = 16.dp),
                    ) {
                        Text(
                            text = stringResource(
                                if (showOfflineBanner) R.string.offline_cached
                                else R.string.no_games,
                            ),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        CompactButton(onClick = { viewModel.refresh() }) {
                            Text(stringResource(R.string.refresh))
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        CompactButton(onClick = onQuickGame) {
                            Text(stringResource(R.string.quick_game))
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        CompactButton(onClick = onSignOut) {
                            Text(stringResource(R.string.sign_out))
                        }
                    }
                }
            }
            else -> {
                TransformingLazyColumn(
                    state = columnState,
                    contentPadding = contentPadding,
                    modifier = Modifier.fillMaxSize().nestedScroll(pullToRefresh),
                ) {
                    item {
                        ListHeader(
                            modifier = Modifier
                                .fillMaxWidth()
                                .transformedHeight(this, transformationSpec)
                                .minimumVerticalContentPadding(ListHeaderDefaults.minimumTopListContentPadding),
                            transformation = SurfaceTransformation(transformationSpec),
                        ) {
                            Text(
                                text = stringResource(R.string.games_title),
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }

                    // Pull-to-refresh feedback: the ring fills with the pull distance and
                    // springs back on release; it spins while a refresh runs.
                    if (refreshing || pullProgress > 0f) {
                        item {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.Center,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                if (refreshing) {
                                    CircularProgressIndicator(modifier = Modifier.size(20.dp))
                                } else {
                                    CircularProgressIndicator(
                                        progress = { displayedPull },
                                        modifier = Modifier.size(20.dp),
                                    )
                                }
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = stringResource(
                                        if (refreshing) R.string.refreshing else R.string.pull_to_refresh
                                    ),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }

                    if (continueQuickGame) {
                        item {
                            Button(
                                onClick = onContinueQuickGame,
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                                ),
                            ) {
                                Text(
                                    text = stringResource(R.string.continue_quick_game),
                                    style = MaterialTheme.typography.labelMedium,
                                )
                            }
                        }
                    }

                    if (state.pendingSyncCount > 0) {
                        item {
                            Text(
                                text = stringResource(R.string.pending_sync, state.pendingSyncCount),
                                style = MaterialTheme.typography.labelSmall,
                                color = tokens.warning,
                                modifier = Modifier.fillMaxWidth(),
                                textAlign = TextAlign.Center
                            )
                        }
                    }

                    if (showOfflineBanner) {
                        item {
                            Text(
                                text = stringResource(R.string.offline_cached),
                                style = MaterialTheme.typography.labelSmall,
                                color = tokens.offline,
                                modifier = Modifier.fillMaxWidth(),
                                textAlign = TextAlign.Center
                            )
                        }
                    }

                    items(state.games, key = { it.id }) { game ->
                        val canScore = game.id in state.canScoreGameIds
                        GameChip(
                            game = game,
                            isSuggested = game.id == state.suggestedGameId,
                            canScore = canScore,
                            onClick = { onGameSelected(game.id) },
                        )
                    }

                    if (state.pastGames.isNotEmpty()) {
                        item {
                            Spacer(modifier = Modifier.height(4.dp))
                            CompactButton(
                                onClick = { viewModel.togglePastGames() },
                            ) {
                                Text(
                                    text = stringResource(
                                        if (state.showPastGames) R.string.hide_past_games
                                        else R.string.show_past_games
                                    ),
                                    style = MaterialTheme.typography.labelSmall,
                                )
                            }
                        }

                        if (state.showPastGames) {
                            items(visiblePastGames, key = { "past-${it.id}" }) { game ->
                                val canScore = game.id in state.canScoreGameIds
                                GameChip(
                                    game = game,
                                    isSuggested = false,
                                    canScore = canScore,
                                    onClick = { onGameSelected(game.id) },
                                )
                            }

                            if (state.visiblePastCount < state.pastGames.size) {
                                item {
                                    CompactButton(
                                        onClick = { viewModel.loadMorePast() },
                                    ) {
                                        Text(
                                            text = stringResource(R.string.load_more),
                                            style = MaterialTheme.typography.labelSmall,
                                        )
                                    }
                                }
                            }
                        }
                    }

                    item {
                        Spacer(modifier = Modifier.height(4.dp))
                        CompactButton(
                            onClick = onQuickGame,
                        ) {
                            Text(
                                text = stringResource(R.string.quick_game),
                                style = MaterialTheme.typography.labelSmall,
                            )
                        }
                    }

                    item {
                        Spacer(modifier = Modifier.height(4.dp))
                        CompactButton(
                            onClick = onHistory,
                        ) {
                            Text(
                                text = stringResource(R.string.history_title),
                                style = MaterialTheme.typography.labelSmall,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun GameChip(
    game: WearGameEntity,
    isSuggested: Boolean,
    canScore: Boolean,
    onClick: () -> Unit,
    nowOverride: java.time.Instant? = null,
) {
    val timeLabel = remember(game.dateTime, nowOverride) {
        formatRelativeTime(game.dateTime, nowOverride ?: java.time.Instant.now())
    }
    val tokens = expressiveTokens()

    Button(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        label = {
            Text(
                text = game.title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        secondaryLabel = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (timeLabel == stringResource(R.string.in_progress)) {
                    Text(
                        text = stringResource(R.string.live_badge),
                        style = MaterialTheme.typography.labelSmall,
                        color = tokens.success,
                    )
                }
                Text(
                    text = timeLabel,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        },
        colors = when {
            isSuggested && canScore -> ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer,
            )
            canScore -> ButtonDefaults.filledTonalButtonColors()
            else -> ButtonDefaults.filledTonalButtonColors(
                contentColor = tokens.offline,
            )
        }
    )
}


internal fun shouldShowOfflineGamesBanner(isOffline: Boolean, isOnline: Boolean): Boolean =
    isOffline && !isOnline

@Composable
private fun rememberNetworkAvailable(): Boolean {
    val connectivityManager = LocalContext.current
        .getSystemService(ConnectivityManager::class.java)
    var isOnline by remember(connectivityManager) {
        mutableStateOf(connectivityManager?.hasValidatedNetwork() == true)
    }

    DisposableEffect(connectivityManager) {
        if (connectivityManager == null) return@DisposableEffect onDispose {}

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) {
                isOnline = connectivityManager.hasValidatedNetwork()
            }

            override fun onLost(network: android.net.Network) {
                isOnline = connectivityManager.hasValidatedNetwork()
            }

            override fun onCapabilitiesChanged(
                network: android.net.Network,
                networkCapabilities: NetworkCapabilities,
            ) {
                isOnline = networkCapabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            }
        }
        connectivityManager.registerDefaultNetworkCallback(callback)
        onDispose { connectivityManager.unregisterNetworkCallback(callback) }
    }
    return isOnline
}

private fun ConnectivityManager.hasValidatedNetwork(): Boolean =
    activeNetwork?.let { getNetworkCapabilities(it) }
        ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
