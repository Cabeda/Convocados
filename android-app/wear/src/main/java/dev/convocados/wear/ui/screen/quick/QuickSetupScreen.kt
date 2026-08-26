package dev.convocados.wear.ui.screen.quick

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.*
import androidx.wear.compose.material3.lazy.rememberTransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight
import dev.convocados.wear.R
import dev.convocados.wear.data.local.QuickGameState

@Composable
fun QuickSetupScreen(
    onStart: (durationMinutes: Int, alarmIntervalMinutes: Int) -> Unit,
    activeGame: QuickGameState? = null,
    onContinue: () -> Unit = {},
    onRestart: () -> Unit = {},
) {
    var duration by remember { mutableIntStateOf(60) }
    var vibrationEnabled by remember { mutableStateOf(false) }
    var alarmInterval by remember { mutableIntStateOf(5) }
    val columnState = rememberTransformingLazyColumnState()
    val transformationSpec = rememberTransformationSpec()

    ScreenScaffold(scrollState = columnState) { contentPadding ->
        TransformingLazyColumn(
            state = columnState,
            contentPadding = contentPadding,
            modifier = Modifier.fillMaxSize(),
        ) {
            item {
                ListHeader(
                    modifier = Modifier
                        .fillMaxWidth()
                        .transformedHeight(this, transformationSpec)
                        .minimumVerticalContentPadding(ListHeaderDefaults.minimumTopListContentPadding),
                    transformation = SurfaceTransformation(transformationSpec),
                ) {
                    Text(
                        text = stringResource(R.string.quick_setup_title),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }

            // Continue an in-progress quick game (timer kept anchored to its start).
            if (activeGame != null) {
                item {
                    Button(
                        onClick = onContinue,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.filledTonalButtonColors(),
                    ) {
                        Text(stringResource(R.string.continue_quick_game))
                    }
                }
                item {
                    CompactButton(
                        onClick = onRestart,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(stringResource(R.string.restart_quick_game))
                    }
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
                            text = stringResource(R.string.rotation_interval_label),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        // Rotation presets (padel/tennis-friendly intervals).
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            listOf(5, 10, 15).forEach { preset ->
                                CompactButton(
                                    onClick = { alarmInterval = preset },
                                    colors = if (alarmInterval == preset) {
                                        ButtonDefaults.buttonColors()
                                    } else {
                                        ButtonDefaults.filledTonalButtonColors()
                                    },
                                ) { Text("$preset") }
                            }
                        }
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
