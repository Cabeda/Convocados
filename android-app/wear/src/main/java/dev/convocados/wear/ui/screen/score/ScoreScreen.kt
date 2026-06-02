package dev.convocados.wear.ui.screen.score

import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
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
import dev.convocados.wear.util.gameProgressFraction
import dev.convocados.wear.util.parseInstant
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
                    // Teams exist and are editable — go straight to score tracking,
                    // regardless of the game's time window.
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

        state.game?.let { game ->
            // Non-interactive overlays: no pointerInput, so taps fall through to the tiles.
            GameProgressBar(
                dateTime = game.dateTime,
                sport = game.sport,
                modifier = Modifier.fillMaxSize(),
            )
            GameClock(
                dateTime = game.dateTime,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 4.dp),
            )
        }
    }
}

/**
 * A full-height team tile: tap to add a point, long-press to subtract one.
 * The team name stays visible above the score so each side is clearly labelled.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TeamScoreButton(
    teamName: String,
    score: Int,
    container: androidx.compose.ui.graphics.Color,
    contentColor: androidx.compose.ui.graphics.Color,
    onIncrement: () -> Unit,
    onDecrement: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    val view = LocalView.current
    Column(
        modifier = modifier
            .fillMaxHeight()
            .clip(RoundedCornerShape(28.dp))
            .background(container)
            .combinedClickable(
                enabled = enabled,
                onClick = {
                    view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                    onIncrement()
                },
                onLongClick = {
                    view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                    onDecrement()
                },
            )
            .padding(horizontal = 6.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = teamName,
            style = MaterialTheme.typography.titleSmall,
            color = contentColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
        Text(
            text = "$score",
            style = MaterialTheme.typography.displayLarge.copy(
                fontSize = 44.sp,
                fontWeight = FontWeight.Bold,
            ),
            color = contentColor,
        )
    }
}

/** Game-progress indicator that hugs the screen edge (circle on round watches,
 *  rounded-rectangle perimeter on rectangular ones), starting at 12 o'clock.
 *  Non-interactive: draws only, so taps fall through to the tiles. */
@Composable
private fun GameProgressBar(dateTime: String, sport: String, modifier: Modifier = Modifier) {
    var progress by remember { mutableFloatStateOf(gameProgressFraction(dateTime, sport)) }

    LaunchedEffect(dateTime, sport) {
        while (true) {
            progress = gameProgressFraction(dateTime, sport)
            delay(1000)
        }
    }

    if (progress <= 0f) return

    val isRound = LocalConfiguration.current.isScreenRound
    val fillColor = MaterialTheme.colorScheme.primary
    val trackColor = MaterialTheme.colorScheme.surfaceContainer

    Canvas(modifier = modifier.fillMaxSize()) {
        val stroke = 5.dp.toPx()
        val left = stroke / 2f + 1.dp.toPx()
        val top = left
        val right = size.width - left
        val bottom = size.height - top
        val w = right - left
        val h = bottom - top
        val r = if (isRound) minOf(w, h) / 2f else 28.dp.toPx()
        val cx = left + w / 2f

        // Perimeter path, clockwise from top-center.
        val path = Path().apply {
            moveTo(cx, top)
            lineTo(right - r, top)
            arcTo(Rect(right - 2 * r, top, right, top + 2 * r), -90f, 90f, false)
            lineTo(right, bottom - r)
            arcTo(Rect(right - 2 * r, bottom - 2 * r, right, bottom), 0f, 90f, false)
            lineTo(left + r, bottom)
            arcTo(Rect(left, bottom - 2 * r, left + 2 * r, bottom), 90f, 90f, false)
            lineTo(left, top + r)
            arcTo(Rect(left, top, left + 2 * r, top + 2 * r), 180f, 90f, false)
            close()
        }

        drawPath(path, trackColor, style = Stroke(width = stroke))

        val measure = PathMeasure().apply { setPath(path, false) }
        val segment = Path()
        measure.getSegment(0f, measure.length * progress.coerceIn(0f, 1f), segment, true)
        drawPath(segment, fillColor, style = Stroke(width = stroke, cap = StrokeCap.Round))
    }
}

/** Lightweight elapsed-time label (m:ss) shown once the game has started. */
@Composable
private fun GameClock(dateTime: String, modifier: Modifier = Modifier) {    var elapsedText by remember { mutableStateOf("") }

    LaunchedEffect(dateTime) {
        while (true) {
            val start = parseInstant(dateTime)
            elapsedText = if (start != null && !Instant.now().isBefore(start)) {
                val s = ChronoUnit.SECONDS.between(start, Instant.now()).coerceAtLeast(0)
                "%d:%02d".format(s / 60, s % 60)
            } else ""
            delay(1000)
        }
    }

    if (elapsedText.isEmpty()) return

    Text(
        text = elapsedText,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurface,
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(horizontal = 10.dp, vertical = 2.dp),
    )
}