package dev.convocados.wear.ui.screen.score

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.*
import com.google.android.horologist.annotations.ExperimentalHorologistApi
import com.google.android.horologist.compose.layout.ScreenScaffold
import com.google.android.horologist.compose.layout.rememberColumnState
import dev.convocados.wear.ui.theme.Success
import dev.convocados.wear.ui.theme.TextMuted
import dev.convocados.wear.ui.theme.Warning

@OptIn(ExperimentalHorologistApi::class)
@Composable
fun ScoreScreen(
    eventId: String,
    viewModel: ScoreViewModel,
    onDone: () -> Unit,
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
                            text = "No game history",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Start the game from\nthe phone app first",
                            style = MaterialTheme.typography.labelSmall,
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
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
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
                style = MaterialTheme.typography.displaySmall.copy(
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold
                ),
                color = MaterialTheme.colorScheme.onSurface,
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
                text = if (state.isSaving) "Saving..." else "Save",
                style = MaterialTheme.typography.labelMedium,
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
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        // Team name (truncated)
        Text(
            text = teamName,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = 60.dp),
        )

        // + button
        IconButton(
            onClick = onIncrement,
            modifier = Modifier.size(32.dp),
            colors = IconButtonDefaults.filledTonalIconButtonColors(),
        ) {
            Text("+", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
        }

        // Score display
        Text(
            text = "$score",
            style = MaterialTheme.typography.displaySmall.copy(
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold
            ),
            color = MaterialTheme.colorScheme.onSurface,
        )

        // - button
        IconButton(
            onClick = onDecrement,
            modifier = Modifier.size(32.dp),
            colors = IconButtonDefaults.filledTonalIconButtonColors(),
        ) {
            Text("-", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
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
            style = MaterialTheme.typography.titleMedium,
            color = Success,
        )

        if (isOfflineQueued) {
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Will sync when online",
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
            Text("Done")
        }
    }
}
