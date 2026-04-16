package dev.convocados.wear.ui.screen.score

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.*
import dev.convocados.wear.R
import dev.convocados.wear.ui.theme.TextMuted

@Composable
fun ScoreScreen(
    eventId: String,
    viewModel: ScoreViewModel,
) {
    LaunchedEffect(eventId) { viewModel.load(eventId) }

    val state by viewModel.uiState.collectAsState()

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
                        text = stringResource(R.string.no_game_history),
                        style = MaterialTheme.typography.body1,
                        color = MaterialTheme.colors.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = stringResource(R.string.start_from_phone),
                        style = MaterialTheme.typography.caption3,
                        color = TextMuted,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            else -> {
                ScoreEditor(
                    state = state,
                    onScoreChange = viewModel::updateScore,
                )
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ScoreEditor(
    state: ScoreUiState,
    onScoreChange: (Team, Int) -> Unit,
) {
    val haptic = LocalHapticFeedback.current

    Column(modifier = Modifier.fillMaxSize()) {
        // Top: game title + sync indicator
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = state.game?.title ?: "",
                    style = MaterialTheme.typography.caption2,
                    color = MaterialTheme.colors.primary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (state.isSyncing) {
                    Text(
                        text = "syncing…",
                        style = MaterialTheme.typography.caption3,
                        color = TextMuted,
                    )
                }
            }
        }

        // Main: two halves — tap +1, long-press -1
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .padding(horizontal = 4.dp, vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            // Team ONE (left half)
            ScoreHalf(
                teamName = state.teamOneName,
                score = state.scoreOne,
                color = MaterialTheme.colors.primary.copy(alpha = 0.15f),
                onTap = {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    onScoreChange(Team.ONE, 1)
                },
                onLongPress = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onScoreChange(Team.ONE, -1)
                },
                modifier = Modifier.weight(1f),
            )

            // Team TWO (right half)
            ScoreHalf(
                teamName = state.teamTwoName,
                score = state.scoreTwo,
                color = MaterialTheme.colors.secondary.copy(alpha = 0.15f),
                onTap = {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    onScoreChange(Team.TWO, 1)
                },
                onLongPress = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onScoreChange(Team.TWO, -1)
                },
                modifier = Modifier.weight(1f),
            )
        }

        // Bottom hint
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 16.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "tap +1 · hold −1",
                style = MaterialTheme.typography.caption3,
                color = TextMuted,
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ScoreHalf(
    teamName: String,
    score: Int,
    color: Color,
    onTap: () -> Unit,
    onLongPress: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxHeight()
            .clip(RoundedCornerShape(16.dp))
            .background(color)
            .combinedClickable(
                onClick = onTap,
                onLongClick = onLongPress,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = teamName,
                style = MaterialTheme.typography.caption3,
                color = MaterialTheme.colors.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 80.dp),
            )
            Text(
                text = "$score",
                fontSize = 40.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colors.onSurface,
            )
        }
    }
}
