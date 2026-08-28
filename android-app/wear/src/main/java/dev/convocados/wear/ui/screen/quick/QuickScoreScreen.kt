package dev.convocados.wear.ui.screen.quick

import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.CompactButton
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import dev.convocados.wear.R
import dev.convocados.wear.ui.RememberKeepScreenOn
import dev.convocados.wear.ui.screen.score.GameClock
import dev.convocados.wear.ui.screen.score.GameEdgeProgress
import dev.convocados.wear.ui.screen.score.TeamScoreButton
import kotlinx.coroutines.delay
import java.time.Instant

@Composable
fun QuickScoreScreen(
    viewModel: QuickScoreViewModel,
    onEnd: () -> Unit = {},
    onRestart: () -> Unit = {},
    onSave: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()

    RememberKeepScreenOn(true)

    val kickoffMs = state.kickoffEpochMs
    if (kickoffMs == null) return // no active quick game; caller handles end

    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = Instant.now()
            delay(1000)
        }
    }

    val totalDurationMs = state.durationMinutes.toLong() * 60_000L
    val elapsedMs = now.toEpochMilli() - kickoffMs
    val progress = (elapsedMs.toFloat() / totalDurationMs).coerceIn(0f, 1f)

    // ADR 0027: alarm tick marks at every interval, next one emphasised.
    val alarmFractions = if (state.alarmIntervalMinutes > 0) {
        (1..(state.durationMinutes / state.alarmIntervalMinutes)).map { i ->
            (i * state.alarmIntervalMinutes * 60_000L).toFloat() / totalDurationMs
        }
    } else emptyList()
    val nextAlarmFraction = if (state.alarmIntervalMinutes > 0) {
        val intervalMs = state.alarmIntervalMinutes * 60_000L
        val next = ((elapsedMs / intervalMs) + 1) * intervalMs
        if (next <= totalDurationMs) (next.toFloat() / totalDurationMs) else null
    } else null

    ScreenScaffold {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    // Swipe up ends the quick game; swipe down saves it to an event.
                    val threshold = 64.dp.toPx()
                    var dragY = 0f
                    detectVerticalDragGestures(
                        onDragStart = { dragY = 0f },
                        onDragEnd = {
                            when {
                                dragY < -threshold -> onEnd()
                                dragY > threshold -> onSave()
                            }
                        },
                    ) { _, dy -> dragY += dy }
                },
        ) {
            if (isQuickStructuredSport(state.sport)) {
                QuickSetScoreEditor(
                    state = state,
                    onIncrementOne = viewModel::incrementScoreOne,
                    onDecrementOne = viewModel::decrementScoreOne,
                    onIncrementTwo = viewModel::incrementScoreTwo,
                    onDecrementTwo = viewModel::decrementScoreTwo,
                    onNextSet = viewModel::advanceSet,
                    onToggleTiebreak = viewModel::toggleTiebreak,
                )
            } else {
                Row(
                    modifier = Modifier.fillMaxSize().padding(2.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    TeamScoreButton(
                        teamName = stringResource(R.string.team_default_1),
                        score = state.scoreOne,
                        container = MaterialTheme.colorScheme.primaryContainer,
                        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                        onIncrement = viewModel::incrementScoreOne,
                        onDecrement = viewModel::decrementScoreOne,
                        enabled = true,
                        modifier = Modifier.weight(1f),
                    )
                    TeamScoreButton(
                        teamName = stringResource(R.string.team_default_2),
                        score = state.scoreTwo,
                        container = MaterialTheme.colorScheme.tertiaryContainer,
                        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                        onIncrement = viewModel::incrementScoreTwo,
                        onDecrement = viewModel::decrementScoreTwo,
                        enabled = true,
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            if (elapsedMs >= 0) {
                GameEdgeProgress(
                    progress = progress,
                    alarmFractions = alarmFractions,
                    nextAlarmFraction = nextAlarmFraction,
                    modifier = Modifier.fillMaxSize(),
                )
                val s = elapsedMs / 1000
                GameClock(
                    text = "%d:%02d".format(s / 60, s % 60),
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 4.dp),
                )
            }

            // Swipe hint (no numeric countdown — ADR 0027).
            Text(
                text = stringResource(R.string.quick_swipe_hint),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 14.dp),
            )
        }
    }
}


@Composable
private fun QuickSetScoreEditor(
    state: QuickScoreUiState,
    onIncrementOne: () -> Unit,
    onDecrementOne: () -> Unit,
    onIncrementTwo: () -> Unit,
    onDecrementTwo: () -> Unit,
    onNextSet: () -> Unit,
    onToggleTiebreak: () -> Unit,
) {
    val currentSet = state.scoreSets.lastOrNull()
    val isTiebreak = currentSet?.tiebreakTeamOne != null && currentSet.tiebreakTeamTwo != null
    val setSummary = state.scoreSets.joinToString(" · ") { set ->
        if (set.tiebreakTeamOne != null && set.tiebreakTeamTwo != null) {
            "${set.teamOne}-${set.teamTwo} (${set.tiebreakTeamOne}-${set.tiebreakTeamTwo})"
        } else {
            "${set.teamOne}-${set.teamTwo}"
        }
    }.ifEmpty { "0-0" }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(start = 4.dp, end = 4.dp, top = 28.dp, bottom = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "$setSummary  ·  ${state.scoreOne}-${state.scoreTwo}",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Text(
            text = if (isTiebreak) {
                stringResource(R.string.quick_tiebreak)
            } else {
                stringResource(R.string.quick_set_number, state.scoreSets.size.coerceAtLeast(1))
            },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
        )
        Row(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            TeamScoreButton(
                teamName = stringResource(R.string.team_default_1),
                score = if (isTiebreak) currentSet?.tiebreakTeamOne ?: 0 else currentSet?.teamOne ?: 0,
                container = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                onIncrement = onIncrementOne,
                onDecrement = onDecrementOne,
                enabled = true,
                modifier = Modifier.weight(1f),
            )
            TeamScoreButton(
                teamName = stringResource(R.string.team_default_2),
                score = if (isTiebreak) currentSet?.tiebreakTeamTwo ?: 0 else currentSet?.teamTwo ?: 0,
                container = MaterialTheme.colorScheme.tertiaryContainer,
                contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                onIncrement = onIncrementTwo,
                onDecrement = onDecrementTwo,
                enabled = true,
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            CompactButton(
                onClick = onNextSet,
                enabled = state.scoreSets.size < 5,
            ) {
                Text(stringResource(R.string.quick_next_set))
            }
            CompactButton(onClick = onToggleTiebreak) {
                Text(stringResource(if (isTiebreak) R.string.quick_games else R.string.quick_tiebreak))
            }
        }
    }
}
