package dev.convocados.wear.ui.screen.score

import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
    readOnly: Boolean = false,
) {
    Box(modifier = Modifier.fillMaxSize()) {
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

/** Lightweight elapsed-time label (m:ss) shown once the game has started. */
@Composable
private fun GameClock(dateTime: String, modifier: Modifier = Modifier) {
    var elapsedText by remember { mutableStateOf("") }

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