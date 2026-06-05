package dev.convocados.wear.ui.screen.quick

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.google.android.horologist.annotations.ExperimentalHorologistApi
import com.google.android.horologist.compose.layout.ScreenScaffold
import com.google.android.horologist.compose.layout.rememberColumnState
import dev.convocados.wear.R
import dev.convocados.wear.ui.screen.score.GameClock
import dev.convocados.wear.ui.screen.score.GameEdgeProgress
import dev.convocados.wear.ui.screen.score.TeamScoreButton
import kotlinx.coroutines.delay
import java.time.Instant

@OptIn(ExperimentalHorologistApi::class)
@Composable
fun QuickScoreScreen(viewModel: QuickScoreViewModel) {
    val state by viewModel.uiState.collectAsState()
    val columnState = rememberColumnState()

    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = Instant.now()
            delay(1000)
        }
    }

    val totalDurationMs = state.durationMinutes.toLong() * 60_000L
    val elapsedMs = now.toEpochMilli() - state.kickoffEpochMs

    // Compute next alarm time
    val nextAlarmSec = if (state.alarmIntervalMinutes > 0 && elapsedMs >= 0) {
        val intervalMs = state.alarmIntervalMinutes * 60_000L
        val nextAlarmMs = ((elapsedMs / intervalMs) + 1) * intervalMs
        if (nextAlarmMs <= totalDurationMs) ((nextAlarmMs - elapsedMs) / 1000).takeIf { it > 0 }
        else null
    } else null

    ScreenScaffold(scrollState = columnState) {
        Box(modifier = Modifier.fillMaxSize()) {
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

            if (elapsedMs >= 0) {
                GameEdgeProgress(
                    progress = (elapsedMs.toFloat() / totalDurationMs).coerceIn(0f, 1f),
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

            // Next alarm countdown at top
            Text(
                text = if (nextAlarmSec != null) "⏰ %d:%02d".format(nextAlarmSec / 60, nextAlarmSec % 60)
                else "",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 14.dp),
            )
        }
    }
}
