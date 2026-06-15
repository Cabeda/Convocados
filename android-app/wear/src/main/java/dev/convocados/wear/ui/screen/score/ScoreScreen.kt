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
import com.google.android.horologist.annotations.ExperimentalHorologistApi
import com.google.android.horologist.compose.layout.ScreenScaffold
import com.google.android.horologist.compose.layout.rememberColumnState
import dev.convocados.wear.R
import dev.convocados.wear.ui.theme.Warning
import dev.convocados.wear.util.parseInstant
import dev.convocados.wear.util.sportDurationMinutes
import kotlinx.coroutines.delay
import java.time.Instant

import dev.convocados.wear.ui.LocalAmbientMode

@OptIn(ExperimentalHorologistApi::class)
@Composable
fun ScoreScreen(
    eventId: String,
    viewModel: ScoreViewModel,
    onTeams: () -> Unit = {},
) {
    LaunchedEffect(eventId) { viewModel.load(eventId) }

    val state by viewModel.uiState.collectAsState()
    val columnState = rememberColumnState()
    val isAmbient = LocalAmbientMode.current

    val shouldKeepScreenOn = state.history != null && state.keepScreenOn
    if (shouldKeepScreenOn) {
        val view = LocalView.current
        DisposableEffect(view) {
            view.keepScreenOn = true
            onDispose {
                view.keepScreenOn = false
            }
        }
    }

    ScreenScaffold(scrollState = columnState) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            when {
                state.isLoading -> {
                    CircularProgressIndicator()
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
                state.history?.editable == false -> {
                    ScoreEditor(
                        state = state,
                        onIncrementOne = {},
                        onDecrementOne = {},
                        onIncrementTwo = {},
                        onDecrementTwo = {},
                        onTeams = onTeams,
                        readOnly = true,
                    )
                }
                else -> {
                    if (isAmbient) {
                        AmbientScoreDisplay(state = state)
                    } else {
                        ScoreEditor(
                            state = state,
                            onIncrementOne = viewModel::incrementScoreOne,
                            onDecrementOne = viewModel::decrementScoreOne,
                            onIncrementTwo = viewModel::incrementScoreTwo,
                            onDecrementTwo = viewModel::decrementScoreTwo,
                            onTeams = onTeams,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ScoreEditor(
    state: ScoreUiState,
    onIncrementOne: () -> Unit,
    onDecrementOne: () -> Unit,
    onIncrementTwo: () -> Unit,
    onDecrementTwo: () -> Unit,
    onTeams: () -> Unit,
    readOnly: Boolean = false,
) {
    // Single 1s ticker drives both the edge progress and the clock.
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = Instant.now()
            delay(1000)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                // Swipe up (within the content) opens the Teams screen.
                val threshold = 64.dp.toPx()
                var dragY = 0f
                detectVerticalDragGestures(
                    onDragStart = { dragY = 0f },
                    onDragEnd = { if (dragY < -threshold) onTeams() },
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
                onIncrement = onIncrementOne,
                onDecrement = onDecrementOne,
                enabled = !readOnly,
                modifier = Modifier.weight(1f),
            )
            TeamScoreButton(
                teamName = state.teamTwoName,
                score = state.scoreTwo,
                container = MaterialTheme.colorScheme.tertiaryContainer,
                contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                onIncrement = onIncrementTwo,
                onDecrement = onDecrementTwo,
                enabled = !readOnly,
                modifier = Modifier.weight(1f),
            )
        }

        // Non-interactive overlays (no pointerInput, so taps fall through to the tiles).
        // Non-interactive overlays (no pointerInput, so taps fall through to the tiles).
        state.game?.let { game ->
            val kickoffMs = state.kickoffEpochMs ?: parseInstant(game.dateTime)?.toEpochMilli()
            if (kickoffMs != null) {
                val durationMs = sportDurationMinutes(game.sport) * 60_000L
                val elapsedMs = now.toEpochMilli() - kickoffMs
                GameEdgeProgress(
                    progress = (elapsedMs.toFloat() / durationMs).coerceIn(0f, 1f),
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

        if (!readOnly) {
            // Show the next-alarm countdown when armed, otherwise the Teams hint.
            val nextSec = state.nextAlarmAtMs?.let { (it - now.toEpochMilli()) / 1000 }?.takeIf { it > 0 }
            Text(
                text = if (nextSec != null) "⏰ %d:%02d".format(nextSec / 60, nextSec % 60)
                else stringResource(R.string.teams_hint),
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
            // Team names
            Text(
                text = "${state.teamOneName} vs ${state.teamTwoName}",
                style = MaterialTheme.typography.labelSmall,
                color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.7f),
            )
            // Game clock
            val kickoffMs = state.kickoffEpochMs
            if (kickoffMs != null) {
                val elapsedMs = now.toEpochMilli() - kickoffMs
                if (elapsedMs >= 0) {
                    val s = elapsedMs / 1000
                    Text(
                        text = "%d:%02d".format(s / 60, s % 60),
                        style = MaterialTheme.typography.labelMedium,
                        color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.5f),
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }
    }
}
