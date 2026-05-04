package dev.convocados.wear.ui.screen.games

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material3.*
import com.google.android.horologist.annotations.ExperimentalHorologistApi
import com.google.android.horologist.compose.layout.ScalingLazyColumn
import com.google.android.horologist.compose.layout.ScalingLazyColumnDefaults
import com.google.android.horologist.compose.layout.ScreenScaffold
import com.google.android.horologist.compose.layout.rememberColumnState
import dev.convocados.wear.R
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.ui.theme.Success
import dev.convocados.wear.ui.theme.TextMuted
import dev.convocados.wear.ui.theme.Warning
import dev.convocados.wear.util.formatRelativeTime
import dev.convocados.wear.util.parseInstant
import java.time.Instant
import java.time.temporal.ChronoUnit

@OptIn(ExperimentalHorologistApi::class)
@Composable
fun GamesScreen(
    viewModel: GamesViewModel,
    onGameSelected: (String) -> Unit,
    onSignOut: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val columnState = rememberColumnState(
        ScalingLazyColumnDefaults.responsive()
    )

    val sortedGames = remember(state.games, state.suggestedGameId) {
        state.games.sortedWith(
            compareBy<WearGameEntity> { it.id != state.suggestedGameId }
                .thenBy { parseInstant(it.dateTime)?.let { t -> kotlin.math.abs(ChronoUnit.MINUTES.between(Instant.now(), t)) } ?: Long.MAX_VALUE }
        )
    }

    val visiblePastGames = remember(state.pastGames, state.visiblePastCount) {
        state.pastGames.take(state.visiblePastCount)
    }

    ScreenScaffold(scrollState = columnState) {
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
                                if (state.isOffline) R.string.offline_cached
                                else R.string.no_games,
                            ),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                        state.error?.let { error ->
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = error,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.error,
                                textAlign = TextAlign.Center,
                                maxLines = 3,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (state.isOffline) {
                            Spacer(modifier = Modifier.height(8.dp))
                            CompactButton(
                                onClick = { viewModel.refresh() },
                            ) {
                                Text(stringResource(R.string.retry))
                            }
                        }
                    }
                }
            }
            else -> {
                ScalingLazyColumn(
                    columnState = columnState,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    item {
                        ListHeader {
                            Text(
                                text = stringResource(R.string.games_title),
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }

                    if (state.pendingSyncCount > 0) {
                        item {
                            Text(
                                text = stringResource(R.string.pending_sync, state.pendingSyncCount),
                                style = MaterialTheme.typography.labelSmall,
                                color = Warning,
                                modifier = Modifier.fillMaxWidth(),
                                textAlign = TextAlign.Center
                            )
                        }
                    }

                    if (state.isOffline) {
                        item {
                            Text(
                                text = stringResource(R.string.offline_cached),
                                style = MaterialTheme.typography.labelSmall,
                                color = TextMuted,
                                modifier = Modifier.fillMaxWidth(),
                                textAlign = TextAlign.Center
                            )
                        }
                    }

                    items(sortedGames, key = { it.id }) { game ->
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
                        Spacer(modifier = Modifier.height(8.dp))
                        CompactButton(
                            onClick = onSignOut,
                        ) {
                            Text(
                                text = stringResource(R.string.sign_out),
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
private fun GameChip(
    game: WearGameEntity,
    isSuggested: Boolean,
    canScore: Boolean,
    onClick: () -> Unit,
) {
    val timeLabel = formatRelativeTime(game.dateTime)

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
                if (isSuggested && canScore) {
                    Text(
                        text = stringResource(R.string.now_label),
                        style = MaterialTheme.typography.labelSmall,
                        color = Success,
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
                contentColor = TextMuted,
            )
        }
    )
}