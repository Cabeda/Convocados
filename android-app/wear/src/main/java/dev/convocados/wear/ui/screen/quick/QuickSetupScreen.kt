package dev.convocados.wear.ui.screen.quick

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material3.*
import com.google.android.horologist.annotations.ExperimentalHorologistApi
import com.google.android.horologist.compose.layout.ScalingLazyColumn
import com.google.android.horologist.compose.layout.ScalingLazyColumnDefaults
import com.google.android.horologist.compose.layout.ScreenScaffold
import com.google.android.horologist.compose.layout.rememberColumnState
import dev.convocados.wear.R

@OptIn(ExperimentalHorologistApi::class)
@Composable
fun QuickSetupScreen(
    onStart: (durationMinutes: Int, periods: Int) -> Unit,
) {
    var duration by remember { mutableIntStateOf(10) }
    var periods by remember { mutableIntStateOf(2) }
    val columnState = rememberColumnState(ScalingLazyColumnDefaults.responsive())

    ScreenScaffold(scrollState = columnState) {
        ScalingLazyColumn(
            columnState = columnState,
            modifier = Modifier.fillMaxSize(),
        ) {
            item {
                ListHeader {
                    Text(
                        text = stringResource(R.string.quick_setup_title),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }

            // Duration picker
            item {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    CompactButton(onClick = { duration = maxOf(5, duration - 5) }) {
                        Text("−")
                    }
                    Text(
                        text = stringResource(R.string.interval_minutes, duration),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(horizontal = 8.dp),
                    )
                    CompactButton(onClick = { duration = minOf(45, duration + 5) }) {
                        Text("+")
                    }
                }
            }

            // Periods picker
            item {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    CompactButton(onClick = { periods = maxOf(1, periods - 1) }) {
                        Text("−")
                    }
                    Text(
                        text = stringResource(R.string.periods_count, periods),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(horizontal = 8.dp),
                    )
                    CompactButton(onClick = { periods = minOf(4, periods + 1) }) {
                        Text("+")
                    }
                }
            }

            // Start button
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Button(
                    onClick = { onStart(duration, periods) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.start_quick_game))
                }
            }
        }
    }
}
