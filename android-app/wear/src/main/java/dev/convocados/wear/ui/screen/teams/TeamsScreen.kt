package dev.convocados.wear.ui.screen.teams

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
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
import dev.convocados.wear.data.local.entity.WearPlayerEntity
import dev.convocados.wear.ui.RememberKeepScreenOn
import dev.convocados.wear.ui.screen.settings.GameSettingsViewModel
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val timeFormat = DateTimeFormatter.ofPattern("HH:mm")

@Composable
fun TeamsScreen(
    eventId: String,
    viewModel: TeamsViewModel,
    settingsViewModel: GameSettingsViewModel,
    onDone: () -> Unit = {},
    onKickoff: () -> Unit = {},
    onAddPlayer: () -> Unit = {},
) {
    LaunchedEffect(eventId) {
        viewModel.load(eventId)
        settingsViewModel.load(eventId)
    }

    val state by viewModel.uiState.collectAsState()
    val settingsState by settingsViewModel.uiState.collectAsState()
    val context = LocalContext.current
    val columnState = rememberTransformingLazyColumnState()
    val transformationSpec = rememberTransformationSpec()

    // Honor the per-event "Keep screen on" setting here too (roster editing),
    // mirroring the scoring screen — otherwise the watch sleeps while the
    // organizer is adding players.
    RememberKeepScreenOn(settingsState.keepScreenOn && !settingsState.isLoading)

    // Pull down at top -> back to score
    val pullThreshold = with(LocalDensity.current) { 72.dp.toPx() }
    var pulled by remember { mutableFloatStateOf(0f) }
    val edgeNav = remember(onDone) {
        object : NestedScrollConnection {
            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                if (available.y > 0f && !columnState.canScrollBackward) {
                    pulled += available.y
                    if (pulled >= pullThreshold) { pulled = 0f; onDone() }
                } else if (available.y < 0f) pulled = 0f
                return Offset.Zero
            }
        }
    }

    ScreenScaffold(scrollState = columnState) { contentPadding ->
        when {
            state.isLoading -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            else -> {
                TransformingLazyColumn(
                    state = columnState,
                    contentPadding = contentPadding,
                    modifier = Modifier.fillMaxSize().nestedScroll(edgeNav),
                ) {
                    // ── Teams section ──────────────────────────────────
                    item {
                        ListHeader(
                            modifier = Modifier
                                .fillMaxWidth()
                                .transformedHeight(this, transformationSpec)
                                .minimumVerticalContentPadding(ListHeaderDefaults.minimumTopListContentPadding),
                            transformation = SurfaceTransformation(transformationSpec),
                        ) {
                            Text(
                                text = stringResource(R.string.teams_title),
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }

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
                        if (state.isReadOnly) {
                            ReadOnlyPlayerChip(player)
                        } else {
                            PlayerChip(
                                player = player,
                                targetTeam = "2",
                                isArrived = player.id in state.arrivedIds,
                                onMove = { viewModel.movePlayerToTeamTwo(player) },
                                onToggleArrived = { viewModel.toggleArrived(player.id) },
                            )
                        }
                    }

                    item { Spacer(modifier = Modifier.height(6.dp)) }

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
                        if (state.isReadOnly) {
                            ReadOnlyPlayerChip(player)
                        } else {
                            PlayerChip(
                                player = player,
                                targetTeam = "1",
                                isArrived = player.id in state.arrivedIds,
                                onMove = { viewModel.movePlayerToTeamOne(player) },
                                onToggleArrived = { viewModel.toggleArrived(player.id) },
                            )
                        }
                    }

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

                    if (state.isSaving) {
                        item {
                            Text(
                                text = stringResource(R.string.saving),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

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

                    // ── Game Settings section ─────────────────────────
                    item { Spacer(modifier = Modifier.height(12.dp)) }
                    item {
                        ListHeader(
                            modifier = Modifier
                                .fillMaxWidth()
                                .transformedHeight(this, transformationSpec)
                                .minimumVerticalContentPadding(ListHeaderDefaults.minimumTopListContentPadding),
                            transformation = SurfaceTransformation(transformationSpec),
                        ) { Text("Game settings", color = MaterialTheme.colorScheme.primary) }
                    }

                    // Kickoff
                    item {
                        val time = Instant.ofEpochMilli(settingsState.kickoffEpochMs)
                            .atZone(ZoneId.systemDefault()).format(timeFormat)
                        Text(
                            text = "Kickoff $time" + if (settingsState.isKickoffOverridden) " (set)" else "",
                            style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = TextAlign.Center,
                        )
                    }
                    item {
                        Button(
                            onClick = {
                                settingsViewModel.kickoffNow()
                                onKickoff()
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Kick off now") }
                    }
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            CompactButton(onClick = { settingsViewModel.nudgeKickoff(-1) }) { Text("−1m") }
                            CompactButton(onClick = { settingsViewModel.nudgeKickoff(1) }) { Text("+1m") }
                            if (settingsState.isKickoffOverridden) {
                                CompactButton(onClick = { settingsViewModel.resetKickoff() }) { Text("Reset") }
                            }
                        }
                    }

                    // Keep Screen On Toggle
                    item {
                        SwitchButton(
                            checked = settingsState.keepScreenOn,
                            onCheckedChange = { settingsViewModel.setKeepScreenOn(it) },
                            label = { Text(stringResource(R.string.keep_screen_on_label)) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    // Full-time chime toggle
                    item {
                        SwitchButton(
                            checked = settingsState.gameEndVibration,
                            onCheckedChange = { settingsViewModel.setGameEndVibration(it) },
                            label = { Text(stringResource(R.string.game_end_vibration_label)) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    // Vibration alerts toggle
                    item {
                        SwitchButton(
                            checked = settingsState.vibrationEnabled,
                            onCheckedChange = { settingsViewModel.setVibrationEnabled(it) },
                            label = { Text("Vibration alerts") },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    if (settingsState.vibrationEnabled) {
                        item {
                            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                                Text(
                                    text = "Every",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.Center,
                                ) {
                                    CompactButton(onClick = { settingsViewModel.setVibrationInterval(settingsState.vibrationIntervalMinutes - 1) }) { Text("−") }
                                    Text(
                                        text = "${settingsState.vibrationIntervalMinutes} min",
                                        style = MaterialTheme.typography.titleMedium,
                                        modifier = Modifier.padding(horizontal = 12.dp),
                                    )
                                    CompactButton(onClick = { settingsViewModel.setVibrationInterval(settingsState.vibrationIntervalMinutes + 1) }) { Text("+") }
                                }
                            }
                        }

                        // Exact-alarm permission
                        if (!settingsState.canScheduleExact) {
                            item {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text(
                                        text = "Alarms may be delayed. Allow exact alarms for on-time buzzes.",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.error,
                                        textAlign = TextAlign.Center,
                                    )
                                    CompactButton(onClick = {
                                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                                            runCatching {
                                                context.startActivity(
                                                    Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                                                        .setData(android.net.Uri.parse("package:${context.packageName}"))
                                                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                                                )
                                            }
                                        }
                                    }) { Text("Allow") }
                                }
                            }
                        }
                    }

                    // Add player button
                    item {
                        Spacer(modifier = Modifier.height(4.dp))
                        CompactButton(onClick = onAddPlayer) {
                            Text(stringResource(R.string.add_player_button))
                        }
                    }

                    // Done button
                    item {
                        Spacer(modifier = Modifier.height(8.dp))
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
private fun ReadOnlyPlayerChip(player: WearPlayerEntity) {
    Text(
        text = player.name,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurface,
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        textAlign = TextAlign.Center,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun PlayerChip(
    player: WearPlayerEntity,
    targetTeam: String,
    isArrived: Boolean,
    onMove: () -> Unit,
    onToggleArrived: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(18.dp))
            .background(MaterialTheme.colorScheme.secondaryContainer)
            .combinedClickable(
                onClick = onMove,
                onLongClick = onToggleArrived,
            )
            .padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        Text(
            text = if (isArrived) "✓ ${player.name}" else player.name,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = stringResource(R.string.move_to_team, targetTeam) +
                if (isArrived) " · " + stringResource(R.string.arrived_label) else "",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun UnassignedPlayerChip(player: WearPlayerEntity, onMoveToOne: () -> Unit, onMoveToTwo: () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text = player.name, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(top = 2.dp)) {
            CompactButton(onClick = onMoveToOne) { Text(text = stringResource(R.string.move_to_team, "1"), style = MaterialTheme.typography.labelSmall) }
            CompactButton(onClick = onMoveToTwo) { Text(text = stringResource(R.string.move_to_team, "2"), style = MaterialTheme.typography.labelSmall) }
        }
    }
}
