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
    onStart: (durationMinutes: Int, alarmIntervalMinutes: Int) -> Unit,
) {
    var duration by remember { mutableIntStateOf(60) }
    var alarmInterval by remember { mutableIntStateOf(10) }
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

            // Game duration picker
            item {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    CompactButton(onClick = { duration = maxOf(10, duration - 10) }) {
                        Text("−")
                    }
                    Text(
                        text = stringResource(R.string.duration_minutes, duration),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(horizontal = 8.dp),
                    )
                    CompactButton(onClick = { duration = minOf(120, duration + 10) }) {
                        Text("+")
                    }
                }
            }

            // Alarm interval picker
            item {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    CompactButton(onClick = { alarmInterval = maxOf(5, alarmInterval - 5) }) {
                        Text("−")
                    }
                    Text(
                        text = stringResource(R.string.alarm_every_minutes, alarmInterval),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(horizontal = 8.dp),
                    )
                    CompactButton(onClick = { alarmInterval = minOf(30, alarmInterval + 5) }) {
                        Text("+")
                    }
                }
            }

            // Start button
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Button(
                    onClick = { onStart(duration, alarmInterval) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.start_quick_game))
                }
            }
        }
    }
}
