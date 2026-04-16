package dev.convocados.wear.ui.screen.games

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.*
import dev.convocados.wear.R
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.ui.theme.Success
import dev.convocados.wear.ui.theme.TextMuted
import dev.convocados.wear.ui.theme.Warning
import dev.convocados.wear.util.formatRelativeTime
import dev.convocados.wear.util.parseInstant
import java.time.Instant
import java.time.temporal.ChronoUnit

@Composable
fun GamesScreen(
    viewModel: GamesViewModel,
    onGameSelected: (String) -> Unit,
    onSignOut: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val listState = rememberScalingLazyListState()

    Box(modifier = Modifier.fillMaxSize()) {
        when {
            state.isLoading && state.games.isEmpty() -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            state.games.isEmpty() -> {
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
                            style = MaterialTheme.typography.body1,
                            color = MaterialTheme.colors.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                        state.error?.let { error ->
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = error,
                                style = MaterialTheme.typography.caption3,
                                color = MaterialTheme.colors.error,
                                textAlign = TextAlign.Center,
                                maxLines = 3,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (state.isOffline) {
                            Spacer(modifier = Modifier.height(8.dp))
                            CompactChip(
                                onClick = { viewModel.refresh() },
                                label = { Text("Retry") },
                                colors = ChipDefaults.primaryChipColors(),
                            )
                        }
                    }
                }
            }
            else -> {
                val sortedGames = state.games.sortedWith(
                    compareBy<WearGameEntity> { it.id != state.suggestedGameId }
                        .thenBy {
                            parseInstant(it.dateTime)?.let { t ->
                                kotlin.math.abs(ChronoUnit.MINUTES.between(Instant.now(), t))
                            } ?: Long.MAX_VALUE
                        }
                )

                ScalingLazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(
                        top = 32.dp,
                        bottom = 16.dp,
                        start = 8.dp,
                        end = 8.dp,
                    ),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    item {
                        Text(
                            text = stringResource(R.string.games_title),
                            style = MaterialTheme.typography.title3,
                            color = MaterialTheme.colors.primary,
                            modifier = Modifier.padding(bottom = 4.dp),
                        )
                    }

                    if (state.pendingSyncCount > 0) {
                        item {
                            Text(
                                text = stringResource(R.string.pending_sync, state.pendingSyncCount),
                                style = MaterialTheme.typography.caption3,
                                color = Warning,
                            )
                        }
                    }

                    if (state.isOffline) {
                        item {
                            Text(
                                text = stringResource(R.string.offline_cached),
                                style = MaterialTheme.typography.caption3,
                                color = TextMuted,
                            )
                        }
                    }

                    items(sortedGames, key = { it.id }) { game ->
                        GameChip(
                            game = game,
                            isSuggested = game.id == state.suggestedGameId,
                            onClick = { onGameSelected(game.id) },
                        )
                    }

                    item {
                        Spacer(modifier = Modifier.height(8.dp))
                        CompactChip(
                            onClick = onSignOut,
                            label = {
                                Text(
                                    text = stringResource(R.string.sign_out),
                                    style = MaterialTheme.typography.caption3,
                                )
                            },
                            colors = ChipDefaults.secondaryChipColors(),
                        )
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
    onClick: () -> Unit,
) {
    val timeLabel = formatRelativeTime(game.dateTime)
    val chipColors = if (isSuggested) {
        ChipDefaults.chipColors(
            backgroundColor = MaterialTheme.colors.primary.copy(alpha = 0.2f),
        )
    } else {
        ChipDefaults.secondaryChipColors()
    }

    Chip(
        onClick = onClick,
        label = {
            Text(
                text = game.title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        secondaryLabel = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (isSuggested) {
                    Text(
                        text = stringResource(R.string.now_label),
                        style = MaterialTheme.typography.caption3,
                        color = Success,
                    )
                }
                Text(
                    text = timeLabel,
                    style = MaterialTheme.typography.caption3,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        },
        colors = chipColors,
        modifier = Modifier.fillMaxWidth(),
    )
}
