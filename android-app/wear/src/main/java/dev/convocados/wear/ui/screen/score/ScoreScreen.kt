package dev.convocados.wear.ui.screen.score

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.*
import dev.convocados.wear.ui.theme.Success
import dev.convocados.wear.ui.theme.TextMuted
import dev.convocados.wear.ui.theme.Warning

@Composable
fun ScoreScreen(
    eventId: String,
    viewModel: ScoreViewModel,
    onDone: () -> Unit,
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
                        text = "No game history",
                        style = MaterialTheme.typography.body1,
                        color = MaterialTheme.colors.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Start the game from\nthe phone app first",
                        style = MaterialTheme.typography.caption3,
                        color = TextMuted,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            state.saved -> {
                SavedConfirmation(
                    isOfflineQueued = state.isOfflineQueued,
                    onDone = onDone,
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
                )
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
    onSave: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        // Game title
        Text(
            text = state.game?.title ?: "Score",
            style = MaterialTheme.typography.caption1,
            color = MaterialTheme.colors.primary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )

        Spacer(modifier = Modifier.height(6.dp))

        // Score row: Team1 [-] score [+]  vs  Team2 [-] score [+]
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Team 1 score
            ScoreColumn(
                teamName = state.teamOneName,
                score = state.scoreOne,
                onIncrement = onIncrementOne,
                onDecrement = onDecrementOne,
            )

            Text(
                text = ":",
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colors.onSurface,
            )

            // Team 2 score
            ScoreColumn(
                teamName = state.teamTwoName,
                score = state.scoreTwo,
                onIncrement = onIncrementTwo,
                onDecrement = onDecrementTwo,
            )
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Save button
        CompactChip(
            onClick = onSave,
            label = {
                Text(
                    text = if (state.isSaving) "Saving..." else "Save",
                    style = MaterialTheme.typography.caption1,
                )
            },
            colors = ChipDefaults.chipColors(
                backgroundColor = MaterialTheme.colors.primary,
                contentColor = MaterialTheme.colors.onPrimary,
            ),
        )
    }
}

@Composable
private fun ScoreColumn(
    teamName: String,
    score: Int,
    onIncrement: () -> Unit,
    onDecrement: () -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        // Team name (truncated)
        Text(
            text = teamName,
            style = MaterialTheme.typography.caption3,
            color = MaterialTheme.colors.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = 60.dp),
        )

        // + button
        Button(
            onClick = onIncrement,
            modifier = Modifier.size(32.dp),
            colors = ButtonDefaults.secondaryButtonColors(),
        ) {
            Text("+", fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }

        // Score display
        Text(
            text = "$score",
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colors.onSurface,
        )

        // - button
        Button(
            onClick = onDecrement,
            modifier = Modifier.size(32.dp),
            colors = ButtonDefaults.secondaryButtonColors(),
        ) {
            Text("-", fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
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
            text = "Score saved!",
            style = MaterialTheme.typography.title3,
            color = Success,
        )

        if (isOfflineQueued) {
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Will sync when online",
                style = MaterialTheme.typography.caption3,
                color = Warning,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(modifier = Modifier.height(12.dp))

        CompactChip(
            onClick = onDone,
            label = { Text("Done") },
            colors = ChipDefaults.secondaryChipColors(),
        )
    }
}
