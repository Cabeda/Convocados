package dev.convocados.wear.ui.screen.score

import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.*
import dev.convocados.wear.R
import dev.convocados.wear.data.api.TennisTeam
import dev.convocados.wear.data.api.displayTennisPoint
import dev.convocados.wear.data.api.displayTennisPointForTeam
import dev.convocados.wear.data.api.tennisGameScore
import dev.convocados.wear.ui.LocalAmbientMode
import dev.convocados.wear.ui.RememberKeepScreenOn
import dev.convocados.wear.ui.theme.Warning
import dev.convocados.wear.util.GameScorePhase
import dev.convocados.wear.util.formatRelativeTime
import dev.convocados.wear.util.gameScorePhase
import dev.convocados.wear.util.parseInstant
import dev.convocados.wear.util.sportDurationMinutes
import kotlinx.coroutines.delay
import java.time.Instant

@Composable
fun ScoreScreen(
    eventId: String,
    viewModel: ScoreViewModel,
    onTeams: () -> Unit = {},
    onFinish: () -> Unit = {},
) {
    LaunchedEffect(eventId) { viewModel.load(eventId) }

    val state by viewModel.uiState.collectAsState()
    val isAmbient = LocalAmbientMode.current
    val view = LocalView.current
    val scorePhase = gameScorePhase(
        dateTime = state.game?.dateTime,
        sport = state.game?.sport ?: "futsal",
        kickoffEpochMs = state.kickoffEpochMs,
    )

    // Hold the screen awake whenever the per-event setting is on — including
    // the pre-start state, so a solo organizer can set up without the watch
    // sleeping mid-game.
    RememberKeepScreenOn(state.keepScreenOn)

    ScreenScaffold {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            when {
                state.isLoading -> {
                    CircularProgressIndicator()
                }
                // Gate by game phase so a game that hasn't started (or has
                // finished) never shows a dead "Start scoring" button. We
                // explain why and offer a useful alternative instead.
                scorePhase == GameScorePhase.NOT_STARTED -> {
                    OffWindowGameContent(
                        state = state,
                        onTeams = onTeams,
                    )
                }
                scorePhase == GameScorePhase.ENDED -> {
                    EndedGameContent(state = state)
                }
                state.history == null -> {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(16.dp),
                    ) {
                        Text(
                            text = state.game?.title ?: stringResource(R.string.score_title),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        if (state.isStarting) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        } else {
                            Button(
                                onClick = { viewModel.startGame() },
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MaterialTheme.colorScheme.primary,
                                    contentColor = MaterialTheme.colorScheme.onPrimary,
                                ),
                            ) {
                                Text(stringResource(R.string.start_scoring))
                            }
                        }
                        state.error?.let { error ->
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = error,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.error,
                                textAlign = TextAlign.Center,
                                maxLines = 2,
                            )
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        CompactButton(onClick = onTeams) {
                            Text(stringResource(R.string.teams_title))
                        }
                    }
                }
                else -> {
                    if (isAmbient) {
                        AmbientScoreDisplay(state = state)
                    } else {
                        if (state.isTennisScoring) {
                            TennisScoreEditor(
                                state = state,
                                onIncrementOne = viewModel::incrementScoreOne,
                                onDecrementOne = viewModel::decrementScoreOne,
                                onIncrementTwo = viewModel::incrementScoreTwo,
                                onDecrementTwo = viewModel::decrementScoreTwo,
                                onNextSet = viewModel::advanceSet,
                                onToggleTiebreak = viewModel::toggleTiebreak,
                                onTeams = onTeams,
                                onFinish = onFinish,
                                onUndo = {
                                    viewModel.undoLastScore()
                                    view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                                },
                            )
                        } else {
                            ScoreEditor(
                                state = state,
                                onIncrementOne = viewModel::incrementScoreOne,
                                onDecrementOne = viewModel::decrementScoreOne,
                                onIncrementTwo = viewModel::incrementScoreTwo,
                                onDecrementTwo = viewModel::decrementScoreTwo,
                                onTeams = onTeams,
                                onFinish = onFinish,
                                onUndo = {
                                    viewModel.undoLastScore()
                                    view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Stateless live-score renderer for deterministic previews and screenshot fixtures.
 * Production navigation keeps lifecycle, loading, and repository orchestration in
 * [ScoreScreen]; this function only renders a supplied state.
 */
@Composable
fun ScoreFixtureContent(
    state: ScoreUiState,
    isAmbient: Boolean = false,
    now: Instant,
    onTeams: () -> Unit = {},
    onFinish: () -> Unit = {},
    onIncrementOne: () -> Unit = {},
    onDecrementOne: () -> Unit = {},
    onIncrementTwo: () -> Unit = {},
    onDecrementTwo: () -> Unit = {},
    onNextSet: () -> Unit = {},
    onToggleTiebreak: () -> Unit = {},
    onUndo: () -> Unit = {},
) {
    ScreenScaffold {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (isAmbient) {
                AmbientScoreDisplay(state)
            } else if (state.isTennisScoring) {
                TennisScoreEditor(
                    state = state,
                    onIncrementOne = onIncrementOne,
                    onDecrementOne = onDecrementOne,
                    onIncrementTwo = onIncrementTwo,
                    onDecrementTwo = onDecrementTwo,
                    onNextSet = onNextSet,
                    onToggleTiebreak = onToggleTiebreak,
                    onTeams = onTeams,
                    onFinish = onFinish,
                    onUndo = onUndo,
                    nowOverride = now,
                )
            } else {
                ScoreEditor(
                    state = state,
                    onIncrementOne = onIncrementOne,
                    onDecrementOne = onDecrementOne,
                    onIncrementTwo = onIncrementTwo,
                    onDecrementTwo = onDecrementTwo,
                    onTeams = onTeams,
                    onFinish = onFinish,
                    onUndo = onUndo,
                    nowOverride = now,
                )
            }
        }
    }
}

@Composable
private fun OffWindowGameContent(
    state: ScoreUiState,
    onTeams: () -> Unit,
) {
    val startsIn = remember(state.game?.dateTime, state.kickoffEpochMs) {
        when {
            state.kickoffEpochMs != null -> formatRelativeTime(Instant.ofEpochMilli(state.kickoffEpochMs).toString())
            else -> state.game?.dateTime?.let { formatRelativeTime(it) }.orEmpty()
        }
    }
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.padding(16.dp),
    ) {
        Text(
            text = state.game?.title ?: stringResource(R.string.score_title),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = stringResource(R.string.game_starts_in, startsIn),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = stringResource(R.string.game_get_ready),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            maxLines = 2,
        )
        Spacer(modifier = Modifier.height(8.dp))
        CompactButton(onClick = onTeams) {
            Text(stringResource(R.string.open_teams))
        }
    }
}

@Composable
private fun EndedGameContent(state: ScoreUiState) {
    val hasStructuredScore = state.isTennisScoring && state.scoreSets.isNotEmpty()
    val hasScore = if (hasStructuredScore) hasCompletedMatch(state.scoreSets) else state.hasFinalScore
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.padding(16.dp),
    ) {
        Text(
            text = state.game?.title ?: stringResource(R.string.score_title),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = stringResource(R.string.game_ended),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (hasScore) {
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = stringResource(R.string.game_ended_result, state.scoreOne, state.scoreTwo),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )
        } else if (hasStructuredScore) {
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = state.scoreSets.joinToString(" · ") { set ->
                    if (set.tiebreakTeamOne != null && set.tiebreakTeamTwo != null) "${set.teamOne}-${set.teamTwo} (${set.tiebreakTeamOne}-${set.tiebreakTeamTwo})" else "${set.teamOne}-${set.teamTwo}"
                },
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )
        } else {
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = stringResource(R.string.game_ended_no_score),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
internal fun TennisScoreEditor(
    state: ScoreUiState,
    onIncrementOne: () -> Unit,
    onDecrementOne: () -> Unit,
    onIncrementTwo: () -> Unit,
    onDecrementTwo: () -> Unit,
    onNextSet: () -> Unit,
    onToggleTiebreak: () -> Unit,
    onTeams: () -> Unit,
    onFinish: () -> Unit,
    onUndo: () -> Unit,
    nowOverride: Instant? = null,
) {
    val currentSet = state.scoreSets.lastOrNull()
    val currentGame = currentSet?.tennisGameScore() ?: dev.convocados.wear.data.api.TennisGameScore()
    Column(Modifier.fillMaxSize().padding(4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = state.scoreSets.joinToString(" · ") { set ->
                if (set.tiebreakTeamOne != null && set.tiebreakTeamTwo != null) "${set.teamOne}-${set.teamTwo} (${set.tiebreakTeamOne}-${set.tiebreakTeamTwo})" else "${set.teamOne}-${set.teamTwo}"
            }.ifEmpty { "New set" } + "  ·  ${displayTennisPoint(currentGame)}",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        state.legacyScalarScore?.let { (one, two) ->
            Text(
                text = "Legacy result $one-$two · tap a team to start point scoring",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        Text("${if (state.isTiebreakScoring) "Tiebreak" else "Set"} ${state.scoreSets.size.coerceAtLeast(1)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
        Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TeamScoreButton(
                teamName = state.teamOneName,
                score = if (state.isTiebreakScoring) currentSet?.tiebreakTeamOne ?: 0 else currentSet?.teamOne ?: 0,
                scoreLabel = if (state.isTiebreakScoring) {
                    (currentSet?.tiebreakTeamOne ?: 0).toString()
                } else {
                    displayTennisPointForTeam(currentGame, TennisTeam.ONE)
                },
                container = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                onIncrement = onIncrementOne,
                onDecrement = onDecrementOne,
                enabled = true,
                modifier = Modifier.weight(1f),
            )
            TeamScoreButton(
                teamName = state.teamTwoName,
                score = if (state.isTiebreakScoring) currentSet?.tiebreakTeamTwo ?: 0 else currentSet?.teamTwo ?: 0,
                scoreLabel = if (state.isTiebreakScoring) {
                    (currentSet?.tiebreakTeamTwo ?: 0).toString()
                } else {
                    displayTennisPointForTeam(currentGame, TennisTeam.TWO)
                },
                container = MaterialTheme.colorScheme.tertiaryContainer,
                contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                onIncrement = onIncrementTwo,
                onDecrement = onDecrementTwo,
                enabled = true,
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            CompactButton(onClick = onNextSet, enabled = state.scoreSets.size < 5) { Text("Next set") }
            CompactButton(onClick = onToggleTiebreak) { Text(if (state.isTiebreakScoring) "Games" else "Tiebreak") }
            CompactButton(onClick = onUndo) { Text("Undo") }
            CompactButton(onClick = onTeams) { Text(stringResource(R.string.teams_title)) }
        }
        ScoreTimeOverlay(state = state, onFinish = onFinish, nowOverride = nowOverride)
    }
}

@Composable
internal fun ScoreEditor(
    state: ScoreUiState,
    onIncrementOne: () -> Unit,
    onDecrementOne: () -> Unit,
    onIncrementTwo: () -> Unit,
    onDecrementTwo: () -> Unit,
    onTeams: () -> Unit,
    onFinish: () -> Unit,
    onUndo: () -> Unit,
    nowOverride: Instant? = null,
) {
    // Stable callbacks so the tiles skip recomposition when the time overlay
    // ticks every second (the tiles themselves don't depend on time).
    val incOne = remember(onIncrementOne) { onIncrementOne }
    val decOne = remember(onDecrementOne) { onDecrementOne }
    val incTwo = remember(onIncrementTwo) { onIncrementTwo }
    val decTwo = remember(onDecrementTwo) { onDecrementTwo }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                // Swipe up opens Teams; swipe down undoes the last score edit.
                val threshold = 64.dp.toPx()
                var dragY = 0f
                detectVerticalDragGestures(
                    onDragStart = { dragY = 0f },
                    onDragEnd = {
                        when {
                            dragY < -threshold -> onTeams()
                            dragY > threshold -> onUndo()
                        }
                    },
                ) { _, dy -> dragY += dy }
            },
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(2.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            TeamScoreButton(
                teamName = state.teamOneName,
                score = state.scoreOne,
                container = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                onIncrement = incOne,
                onDecrement = decOne,
                enabled = true,
                modifier = Modifier.weight(1f),
            )
            TeamScoreButton(
                teamName = state.teamTwoName,
                score = state.scoreTwo,
                container = MaterialTheme.colorScheme.tertiaryContainer,
                contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                onIncrement = incTwo,
                onDecrement = decTwo,
                enabled = true,
                modifier = Modifier.weight(1f),
            )
        }

        // Time-dependent overlays live in their own tick-scoped composable so
        // the per-second clock/progress redraw doesn't recompose the tiles.
        ScoreTimeOverlay(state = state, onFinish = onFinish, nowOverride = nowOverride)
    }
}

@Composable
internal fun ScoreTimeOverlay(
    state: ScoreUiState,
    onFinish: () -> Unit,
    nowOverride: Instant? = null,
) {
    var now by remember(nowOverride) { mutableStateOf(nowOverride ?: Instant.now()) }
    if (nowOverride == null) {
        LaunchedEffect(Unit) {
            while (true) {
                now = Instant.now()
                delay(1000)
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        state.game?.let { game ->
            val kickoffMs = state.kickoffEpochMs ?: parseInstant(game.dateTime)?.toEpochMilli()
            if (kickoffMs != null) {
                val durationMs = sportDurationMinutes(game.sport) * 60_000L
                val elapsedMs = now.toEpochMilli() - kickoffMs
                GameEdgeProgress(
                    progress = (elapsedMs.toFloat() / durationMs).coerceIn(0f, 1f),
                    alarmFractions = state.alarmFractions,
                    nextAlarmFraction = state.nextAlarmFraction,
                    modifier = Modifier.fillMaxSize(),
                )
                if (elapsedMs >= 0) {
                    val s = elapsedMs / 1000
                    GameClock(
                        text = "%d:%02d".format(s / 60, s % 60),
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(bottom = 4.dp),
                    )
                }
            }
        }

        // Once the game window elapses, offer to finish (persist + return).
        val kickoffMs = state.kickoffEpochMs
        val gameOver = kickoffMs != null && state.game != null &&
            now.toEpochMilli() >= kickoffMs + sportDurationMinutes(state.game.sport) * 60_000L

        if (gameOver) {
            CompactButton(
                onClick = onFinish,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 14.dp),
            ) {
                Text(stringResource(R.string.finish_game))
            }
        } else {
            Text(
                text = stringResource(R.string.teams_hint),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 14.dp),
            )
        }

        if (state.isOfflineQueued) {
            Text(
                text = stringResource(R.string.will_sync_online),
                style = MaterialTheme.typography.labelSmall,
                color = Warning,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 26.dp),
            )
        }
    }
}

/**
 * A full-height team tile: tap to add a point, long-press to subtract one.
 * The team name stays visible above the score so each side is clearly labelled.
 * NOTE: Moved to ScoreComponents.kt as internal — kept here as delegation.
 */

/** Game-progress indicator — see ScoreComponents.kt */

/** Simplified white-on-black score display for ambient (always-on) mode. */
@Composable
private fun AmbientScoreDisplay(state: ScoreUiState) {
    var now by remember { mutableStateOf(Instant.now()) }
    // Update once per minute in ambient to save power
    LaunchedEffect(Unit) {
        while (true) {
            now = Instant.now()
            delay(60_000)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(androidx.compose.ui.graphics.Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            // Score
            Text(
                text = "${state.scoreOne} - ${state.scoreTwo}",
                style = MaterialTheme.typography.displayMedium,
                color = androidx.compose.ui.graphics.Color.White,
            )
            if (state.isTennisScoring) {
                state.scoreSets.lastOrNull()?.let { activeSet ->
                    val setDetails = if (activeSet.tiebreakTeamOne != null && activeSet.tiebreakTeamTwo != null) {
                        "${activeSet.teamOne}-${activeSet.teamTwo} (${activeSet.tiebreakTeamOne}-${activeSet.tiebreakTeamTwo})"
                    } else {
                        "${activeSet.teamOne}-${activeSet.teamTwo} · ${displayTennisPoint(activeSet.tennisGameScore())}"
                    }
                    Text(
                        text = setDetails,
                        style = MaterialTheme.typography.labelMedium,
                        color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.8f),
                    )
                }
            }
            // Team names
            Text(
                text = "${state.teamOneName} vs ${state.teamTwoName}",
                style = MaterialTheme.typography.labelSmall,
                color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.7f),
            )
            // Game clock (or "Ended" once the game window has elapsed).
            val kickoffMs = state.kickoffEpochMs
            if (kickoffMs != null) {
                val durationMs = state.game?.let { sportDurationMinutes(it.sport) * 60_000L } ?: 0L
                val elapsedMs = now.toEpochMilli() - kickoffMs
                val ended = durationMs > 0 && elapsedMs >= durationMs
                if (elapsedMs >= 0) {
                    val s = elapsedMs / 1000
                    Text(
                        text = if (ended) stringResource(R.string.ended_label) else "%d:%02d".format(s / 60, s % 60),
                        style = MaterialTheme.typography.labelMedium,
                        color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.5f),
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }
    }
}
