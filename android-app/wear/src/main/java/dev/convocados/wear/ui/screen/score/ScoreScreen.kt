package dev.convocados.wear.ui.screen.score

import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.*
import com.google.android.horologist.annotations.ExperimentalHorologistApi
import com.google.android.horologist.compose.layout.ScreenScaffold
import com.google.android.horologist.compose.layout.rememberColumnState
import dev.convocados.wear.R
import dev.convocados.wear.ui.theme.Success
import dev.convocados.wear.ui.theme.TextMuted
import dev.convocados.wear.ui.theme.Warning
import dev.convocados.wear.util.gameProgressFraction
import dev.convocados.wear.util.parseInstant
import dev.convocados.wear.util.sportDurationMinutes
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.temporal.ChronoUnit

@OptIn(ExperimentalHorologistApi::class)
@Composable
fun ScoreScreen(
    eventId: String,
    viewModel: ScoreViewModel,
    onTeams: () -> Unit = {},
    onDone: () -> Unit = {},
) {
    LaunchedEffect(eventId) { viewModel.load(eventId) }

    val state by viewModel.uiState.collectAsState()
    val columnState = rememberColumnState()

    ScreenScaffold(scrollState = columnState) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            // Game timer arc around the bezel
            state.game?.let { game ->
                GameTimerArc(dateTime = game.dateTime, sport = game.sport)
            }

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
                            text = stringResource(R.string.no_game_history),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = stringResource(R.string.start_from_phone),
                            style = MaterialTheme.typography.labelSmall,
                            color = TextMuted,
                            textAlign = TextAlign.Center,
                        )
                        if (state.game != null) {
                            Spacer(modifier = Modifier.height(8.dp))
                            CompactButton(onClick = onTeams) {
                                Text(stringResource(R.string.teams_title))
                            }
                        }
                    }
                }
                state.saved -> {
                    SavedConfirmation(
                        isOfflineQueued = state.isOfflineQueued,
                        onDone = onDone,
                    )
                }
                !state.canScore -> {
                    NotYetScoreScreen(
                        state = state,
                        onTeams = onTeams,
                    )
                }
                state.history?.editable == false -> {
                    ScoreEditor(
                        state = state,
                        onIncrementOne = {},
                        onDecrementOne = {},
                        onIncrementTwo = {},
                        onDecrementTwo = {},
                        onSave = {},
                        onTeams = onTeams,
                        readOnly = true,
                    )
                }
                else -> {
                    ScoreEditor(
                        state = state,
                        onIncrementOne = viewModel::incrementScoreOne,
                        onDecrementOne = viewModel::decrementScoreOne,
                        onIncrementTwo = viewModel::incrementScoreTwo,
                        onDecrementTwo = viewModel::decrementScoreTwo,
                        onSave = viewModel::saveScore,
                        onTeams = onTeams,
                    )
                }
            }
        }
    }
}

@Composable
private fun NotYetScoreScreen(
    state: ScoreUiState,
    onTeams: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
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
            text = stringResource(R.string.score_not_yet),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )

        Spacer(modifier = Modifier.height(12.dp))

        CompactButton(onClick = onTeams) {
            Text(stringResource(R.string.manage_teams))
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
    onSave: () -> Unit,
    onTeams: () -> Unit,
    readOnly: Boolean = false,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = state.game?.title ?: stringResource(R.string.score_title),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )

        Spacer(modifier = Modifier.height(4.dp))

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
            modifier = Modifier.fillMaxWidth(),
        ) {
            ScoreColumn(
                teamName = state.teamOneName,
                score = state.scoreOne,
                onIncrement = onIncrementOne,
                onDecrement = onDecrementOne,
                enabled = !readOnly,
            )

            Text(
                text = ":",
                style = MaterialTheme.typography.displaySmall.copy(
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold
                ),
                color = MaterialTheme.colorScheme.onSurface,
            )

            ScoreColumn(
                teamName = state.teamTwoName,
                score = state.scoreTwo,
                onIncrement = onIncrementTwo,
                onDecrement = onDecrementTwo,
                enabled = !readOnly,
            )
        }

        Spacer(modifier = Modifier.height(4.dp))

        if (readOnly) {
            Text(
                text = stringResource(R.string.score_read_only),
                style = MaterialTheme.typography.labelSmall,
                color = TextMuted,
            )
        } else {
            Button(
                onClick = onSave,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
            ) {
                Text(
                    text = if (state.isSaving) stringResource(R.string.saving) else stringResource(R.string.save),
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }

        Spacer(modifier = Modifier.height(4.dp))

        CompactButton(onClick = onTeams) {
            Text(
                text = stringResource(R.string.manage_teams),
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun ScoreColumn(
    teamName: String,
    score: Int,
    onIncrement: () -> Unit,
    onDecrement: () -> Unit,
    enabled: Boolean = true,
) {
    val view = LocalView.current
    val hapticEnabled = enabled

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            text = teamName,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = 60.dp),
        )

        IconButton(
            onClick = {
                if (hapticEnabled) view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onIncrement()
            },
            modifier = Modifier.size(32.dp),
            colors = IconButtonDefaults.filledTonalIconButtonColors(),
            enabled = enabled,
        ) {
            Text("+", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
        }

        Text(
            text = "$score",
            style = MaterialTheme.typography.displaySmall.copy(
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold
            ),
            color = MaterialTheme.colorScheme.onSurface,
        )

        IconButton(
            onClick = {
                if (hapticEnabled) view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onDecrement()
            },
            modifier = Modifier.size(32.dp),
            colors = IconButtonDefaults.filledTonalIconButtonColors(),
            enabled = enabled,
        ) {
            Text("-", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
        }
    }
}

/**
 * Draws a progress arc around the screen edge showing elapsed game time.
 * Fills clockwise from 12 o'clock. Shows elapsed time text at the top.
 */
@Composable
private fun GameTimerArc(dateTime: String, sport: String) {
    var progress by remember { mutableFloatStateOf(gameProgressFraction(dateTime, sport)) }
    var elapsedText by remember { mutableStateOf("") }

    LaunchedEffect(dateTime, sport) {
        while (true) {
            progress = gameProgressFraction(dateTime, sport)
            val start = parseInstant(dateTime)
            if (start != null) {
                val elapsed = ChronoUnit.SECONDS.between(start, Instant.now()).coerceAtLeast(0)
                val min = elapsed / 60
                val sec = elapsed % 60
                elapsedText = "%d:%02d".format(min, sec)
            }
            delay(1000)
        }
    }

    if (progress <= 0f) return

    val arcColor = MaterialTheme.colorScheme.primary
    val trackColor = MaterialTheme.colorScheme.surfaceContainer

    Canvas(modifier = Modifier.fillMaxSize()) {
        val strokeWidth = 6.dp.toPx()
        val padding = 4.dp.toPx()
        val arcSize = Size(size.width - padding * 2, size.height - padding * 2)
        val topLeft = Offset(padding, padding)

        // Background track
        drawArc(
            color = trackColor,
            startAngle = -90f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = topLeft,
            size = arcSize,
            style = Stroke(width = strokeWidth, cap = StrokeCap.Round),
        )

        // Progress arc
        drawArc(
            color = arcColor,
            startAngle = -90f,
            sweepAngle = 360f * progress,
            useCenter = false,
            topLeft = topLeft,
            size = arcSize,
            style = Stroke(width = strokeWidth, cap = StrokeCap.Round),
        )
    }

    // Elapsed time at top
    Box(
        modifier = Modifier.fillMaxSize().padding(top = 14.dp),
        contentAlignment = Alignment.TopCenter,
    ) {
        Text(
            text = elapsedText,
            style = MaterialTheme.typography.labelSmall,
            color = arcColor,
        )
    }
}

@Composable
private fun SavedConfirmation(
    isOfflineQueued: Boolean,
    onDone: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = stringResource(R.string.score_saved),
            style = MaterialTheme.typography.titleMedium,
            color = Success,
        )

        if (isOfflineQueued) {
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = stringResource(R.string.will_sync_online),
                style = MaterialTheme.typography.labelSmall,
                color = Warning,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(modifier = Modifier.height(12.dp))

        Button(
            onClick = onDone,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            colors = ButtonDefaults.filledTonalButtonColors(),
        ) {
            Text(stringResource(R.string.done))
        }
    }
}