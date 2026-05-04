package dev.convocados.wear.ui.screen.teams

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
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
import dev.convocados.wear.data.local.entity.WearPlayerEntity

@OptIn(ExperimentalHorologistApi::class)
@Composable
fun TeamsScreen(
    eventId: String,
    viewModel: TeamsViewModel,
    onDone: () -> Unit = {},
) {
    LaunchedEffect(eventId) { viewModel.load(eventId) }

    val state by viewModel.uiState.collectAsState()
    val columnState = rememberColumnState(
        ScalingLazyColumnDefaults.responsive()
    )

    ScreenScaffold(scrollState = columnState) {
        when {
            state.isLoading -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            else -> {
                ScalingLazyColumn(
                    columnState = columnState,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    // Header
                    item {
                        ListHeader {
                            Text(
                                text = stringResource(R.string.teams_title),
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }

                    // Team 1 header and players
                    item {
                        Text(
                            text = state.teamOneName,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    if (state.teamOnePlayers.isEmpty()) {
                        item {
                            Text(
                                text = stringResource(R.string.no_players),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    items(state.teamOnePlayers, key = { "t1-${it.id}" }) { player ->
                        PlayerChip(
                            player = player,
                            targetTeam = "2",
                            onMove = { viewModel.movePlayerToTeamTwo(player) },
                        )
                    }

                    // Spacer
                    item { Spacer(modifier = Modifier.height(6.dp)) }

                    // Team 2 header and players
                    item {
                        Text(
                            text = state.teamTwoName,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    if (state.teamTwoPlayers.isEmpty()) {
                        item {
                            Text(
                                text = stringResource(R.string.no_players),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    items(state.teamTwoPlayers, key = { "t2-${it.id}" }) { player ->
                        PlayerChip(
                            player = player,
                            targetTeam = "1",
                            onMove = { viewModel.movePlayerToTeamOne(player) },
                        )
                    }

                    // Unassigned players
                    if (state.unassigned.isNotEmpty()) {
                        item { Spacer(modifier = Modifier.height(6.dp)) }
                        item {
                            Text(
                                text = stringResource(R.string.unassigned),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        items(state.unassigned, key = { "u-${it.id}" }) { player ->
                            UnassignedPlayerChip(
                                player = player,
                                onMoveToOne = { viewModel.movePlayerToTeamOne(player) },
                                onMoveToTwo = { viewModel.movePlayerToTeamTwo(player) },
                            )
                        }
                    }

                    // Bench players (read-only)
                    if (state.bench.isNotEmpty()) {
                        item { Spacer(modifier = Modifier.height(6.dp)) }
                        item {
                            Text(
                                text = stringResource(R.string.bench),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        items(state.bench, key = { "b-${it.id}" }) { player ->
                            Text(
                                text = player.name,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.fillMaxWidth(),
                                textAlign = TextAlign.Center,
                            )
                        }
                    }

                    // Saving indicator
                    if (state.isSaving) {
                        item {
                            Text(
                                text = stringResource(R.string.saving),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    // Error message
                    state.error?.let { error ->
                        item {
                            Text(
                                text = error,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.error,
                                textAlign = TextAlign.Center,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }

                    // Done button
                    item {
                        Spacer(modifier = Modifier.height(4.dp))
                        CompactButton(onClick = onDone) {
                            Text(stringResource(R.string.done))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlayerChip(
    player: WearPlayerEntity,
    targetTeam: String,
    onMove: () -> Unit,
) {
    Button(
        onClick = onMove,
        modifier = Modifier.fillMaxWidth(),
        label = {
            Text(
                text = player.name,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        secondaryLabel = {
            Text(
                text = stringResource(R.string.move_to_team, targetTeam),
                style = MaterialTheme.typography.labelSmall,
            )
        },
    )
}

@Composable
private fun UnassignedPlayerChip(
    player: WearPlayerEntity,
    onMoveToOne: () -> Unit,
    onMoveToTwo: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = player.name,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.padding(top = 2.dp),
        ) {
            CompactButton(onClick = onMoveToOne) {
                Text(
                    text = stringResource(R.string.move_to_team, "1"),
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            CompactButton(onClick = onMoveToTwo) {
                Text(
                    text = stringResource(R.string.move_to_team, "2"),
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
    }
}