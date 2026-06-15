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
    var vibrationEnabled by remember { mutableStateOf(false) }
    var alarmInterval by remember { mutableIntStateOf(5) }
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
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = stringResource(R.string.duration_label),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        CompactButton(onClick = { duration = maxOf(10, duration - 10) }) { Text("−") }
                        Text(
                            text = stringResource(R.string.minutes_value, duration),
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.padding(horizontal = 12.dp),
                        )
                        CompactButton(onClick = { duration = minOf(120, duration + 10) }) { Text("+") }
                    }
                }
            }

            // Vibration toggle
            item {
                SwitchButton(
                    checked = vibrationEnabled,
                    onCheckedChange = { vibrationEnabled = it },
                    label = { Text("Vibration alerts") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            // Alarm interval picker (only when vibration enabled)
            if (vibrationEnabled) {
                item {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = "Every",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            CompactButton(onClick = { alarmInterval = maxOf(1, alarmInterval - 1) }) { Text("−") }
                            Text(
                                text = stringResource(R.string.minutes_value, alarmInterval),
                                style = MaterialTheme.typography.titleMedium,
                                modifier = Modifier.padding(horizontal = 12.dp),
                            )
                            CompactButton(onClick = { alarmInterval = minOf(30, alarmInterval + 1) }) { Text("+") }
                        }
                    }
                }
            }

            // Start button
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Button(
                    onClick = { onStart(duration, if (vibrationEnabled) alarmInterval else 0) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.start_quick_game))
                }
            }
        }
    }
}
