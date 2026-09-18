package dev.convocados.wear.ui.screen.quick

import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonGroup
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import dev.convocados.wear.R
import dev.convocados.wear.data.api.TennisTeam
import dev.convocados.wear.data.api.displayTennisPoint
import dev.convocados.wear.data.api.displayTennisPointForTeam
import dev.convocados.wear.data.api.tennisGameScore
import dev.convocados.wear.ui.RememberKeepScreenOn
import dev.convocados.wear.ui.roundSafeSize
import dev.convocados.wear.ui.ongoing.RememberOngoingActivity
import dev.convocados.wear.ui.ongoing.ongoingScoreText
import dev.convocados.wear.ui.ongoing.shouldShowQuickGameOngoing
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
    // Play policy: a running quick game must surface an Ongoing Activity.
    RememberOngoingActivity(
        enabled = shouldShowQuickGameOngoing(kickoffMs, state.durationMinutes, System.currentTimeMillis()),
        title = stringResource(R.string.ongoing_quick_title),
        text = ongoingScoreText(
            stringResource(R.string.team_default_1),
            state.scoreOne,
            stringResource(R.string.team_default_2),
            state.scoreTwo,
        ),
    )
    if (kickoffMs == null) return // no active quick game; caller handles end

    QuickScoreContent(
        state = state,
        onIncrementOne = viewModel::incrementScoreOne,
        onDecrementOne = viewModel::decrementScoreOne,
        onIncrementTwo = viewModel::incrementScoreTwo,
        onDecrementTwo = viewModel::decrementScoreTwo,
        onNextSet = viewModel::advanceSet,
        onToggleTiebreak = viewModel::toggleTiebreak,
        onEnd = onEnd,
        onSave = onSave,
    )
}

/**
 * Stateless quick-game renderer for deterministic previews and shape-regression
 * screenshots. Production lifecycle/ongoing-activity wiring lives in
 * [QuickScoreScreen].
 */
@Composable
internal fun QuickScoreContent(
    state: QuickScoreUiState,
    onIncrementOne: () -> Unit,
    onDecrementOne: () -> Unit,
    onIncrementTwo: () -> Unit,
    onDecrementTwo: () -> Unit,
    onNextSet: () -> Unit,
    onToggleTiebreak: () -> Unit,
    onEnd: () -> Unit = {},
    onSave: () -> Unit = {},
    nowOverride: Instant? = null,
) {
    val kickoffMs = state.kickoffEpochMs ?: return

    var now by remember(nowOverride) { mutableStateOf(nowOverride ?: Instant.now()) }
    if (nowOverride == null) {
        LaunchedEffect(Unit) {
            while (true) {
                now = Instant.now()
                delay(1000)
            }
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

    ScreenScaffold { contentPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(contentPadding)
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
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    QuickSetScoreEditor(
                        modifier = Modifier.roundSafeSize(),
                        state = state,
                        onIncrementOne = onIncrementOne,
                        onDecrementOne = onDecrementOne,
                        onIncrementTwo = onIncrementTwo,
                        onDecrementTwo = onDecrementTwo,
                        onNextSet = onNextSet,
                        onToggleTiebreak = onToggleTiebreak,
                    )
                }
            } else {
                Row(
                    // Bezel-safe inset so tiles sit inside the round display;
                    // roundSafeSize keeps the whole editor inside the bezel.
                    modifier = Modifier
                        .align(Alignment.Center)
                        .roundSafeSize()
                        .padding(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    TeamScoreButton(
                        teamName = stringResource(R.string.team_default_1),
                        score = state.scoreOne,
                        container = MaterialTheme.colorScheme.primaryContainer,
                        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                        onIncrement = onIncrementOne,
                        onDecrement = onDecrementOne,
                        enabled = true,
                        modifier = Modifier.weight(1f),
                    )
                    TeamScoreButton(
                        teamName = stringResource(R.string.team_default_2),
                        score = state.scoreTwo,
                        container = MaterialTheme.colorScheme.tertiaryContainer,
                        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                        onIncrement = onIncrementTwo,
                        onDecrement = onDecrementTwo,
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

            // Swipe hint (no numeric countdown — ADR 0027). Clears the
            // 12-o'clock progress marker on round screens; pill background
            // keeps it legible where the marker crosses.
            Text(
                text = stringResource(R.string.quick_swipe_hint),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 20.dp)
                    .clip(RoundedCornerShape(50))
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .padding(horizontal = 10.dp, vertical = 2.dp),
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
    modifier: Modifier = Modifier,
) {
    val currentSet = state.scoreSets.lastOrNull()
    val currentGame = currentSet?.tennisGameScore() ?: dev.convocados.wear.data.api.TennisGameScore()
    val isTiebreak = currentSet?.tiebreakTeamOne != null && currentSet.tiebreakTeamTwo != null
    val setSummary = state.scoreSets.joinToString(" · ") { set ->
        if (set.tiebreakTeamOne != null && set.tiebreakTeamTwo != null) {
            "${set.teamOne}-${set.teamTwo} (${set.tiebreakTeamOne}-${set.tiebreakTeamTwo})"
        } else {
            "${set.teamOne}-${set.teamTwo}"
        }
    }.ifEmpty { "0-0" }

    Column(
        modifier = modifier
            .padding(start = 4.dp, end = 4.dp, top = 28.dp, bottom = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "$setSummary  ·  ${state.scoreOne}-${state.scoreTwo}  ·  ${displayTennisPoint(currentGame)}",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = if (isTiebreak) {
                stringResource(R.string.quick_tiebreak)
            } else {
                stringResource(R.string.quick_set_number, state.scoreSets.size.coerceAtLeast(1))
            },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Row(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            TeamScoreButton(
                teamName = stringResource(R.string.team_default_1),
                score = if (isTiebreak) currentSet?.tiebreakTeamOne ?: 0 else currentSet?.teamOne ?: 0,
                scoreLabel = if (isTiebreak) {
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
                teamName = stringResource(R.string.team_default_2),
                score = if (isTiebreak) currentSet?.tiebreakTeamTwo ?: 0 else currentSet?.teamTwo ?: 0,
                scoreLabel = if (isTiebreak) {
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
        // Expressive connected actions instead of loose CompactButtons.
        val nextSetSource = remember { MutableInteractionSource() }
        val tiebreakSource = remember { MutableInteractionSource() }
        ButtonGroup(Modifier.fillMaxWidth()) {
            Button(
                onClick = onNextSet,
                enabled = state.scoreSets.size < 5,
                modifier = Modifier.animateWidth(nextSetSource),
                interactionSource = nextSetSource,
            ) {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text(stringResource(R.string.quick_next_set))
                }
            }
            Button(onClick = onToggleTiebreak,
                modifier = Modifier.animateWidth(tiebreakSource),
                interactionSource = tiebreakSource,
            ) {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text(stringResource(if (isTiebreak) R.string.quick_games else R.string.quick_tiebreak))
                }
            }
        }
    }
}
