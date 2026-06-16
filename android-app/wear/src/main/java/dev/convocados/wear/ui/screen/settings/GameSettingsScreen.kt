package dev.convocados.wear.ui.screen.settings

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import dev.convocados.wear.R
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.*
import com.google.android.horologist.annotations.ExperimentalHorologistApi
import com.google.android.horologist.compose.layout.ScalingLazyColumn
import com.google.android.horologist.compose.layout.ScalingLazyColumnDefaults
import com.google.android.horologist.compose.layout.ScreenScaffold
import com.google.android.horologist.compose.layout.rememberColumnState
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val timeFormat = DateTimeFormatter.ofPattern("HH:mm")

@OptIn(ExperimentalHorologistApi::class)
@Composable
fun GameSettingsScreen(
    eventId: String,
    viewModel: GameSettingsViewModel,
    onBack: () -> Unit = {},
) {
    LaunchedEffect(eventId) { viewModel.load(eventId) }

    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val columnState = rememberColumnState(ScalingLazyColumnDefaults.responsive())

    // Pull down at the top to go back to Teams.
    val pullThreshold = with(LocalDensity.current) { 72.dp.toPx() }
    var pulled by remember { mutableFloatStateOf(0f) }
    val pullToBack = remember(onBack) {
        object : NestedScrollConnection {
            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                if (available.y > 0f && !columnState.state.canScrollBackward) {
                    pulled += available.y
                    if (pulled >= pullThreshold) { pulled = 0f; onBack() }
                } else if (available.y < 0f) pulled = 0f
                return Offset.Zero
            }
        }
    }

    ScreenScaffold(scrollState = columnState) {
        ScalingLazyColumn(
            columnState = columnState,
            modifier = Modifier.fillMaxSize().nestedScroll(pullToBack),
        ) {
            item {
                ListHeader { Text("Game settings", color = MaterialTheme.colorScheme.primary) }
            }

            // ── Kickoff ─────────────────────────────────────────────
            item {
                val time = Instant.ofEpochMilli(state.kickoffEpochMs)
                    .atZone(ZoneId.systemDefault()).format(timeFormat)
                Text(
                    text = "Kickoff $time" + if (state.isKickoffOverridden) " (set)" else "",
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center,
                )
            }
            item {
                Button(
                    onClick = { viewModel.kickoffNow() },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Kick off now") }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    CompactButton(onClick = { viewModel.nudgeKickoff(-1) }) { Text("−1m") }
                    CompactButton(onClick = { viewModel.nudgeKickoff(1) }) { Text("+1m") }
                    if (state.isKickoffOverridden) {
                        CompactButton(onClick = { viewModel.resetKickoff() }) { Text("Reset") }
                    }
                }
            }

            item {
                SwitchButton(
                    checked = state.keepScreenOn,
                    onCheckedChange = { viewModel.setKeepScreenOn(it) },
                    label = { Text(stringResource(R.string.keep_screen_on_label)) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            // ── Vibration alerts ─────────────────────────────────────
            item {
                SwitchButton(
                    checked = state.vibrationEnabled,
                    onCheckedChange = { viewModel.setVibrationEnabled(it) },
                    label = { Text("Vibration alerts") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            if (state.vibrationEnabled) {
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
                            CompactButton(onClick = { viewModel.setVibrationInterval(state.vibrationIntervalMinutes - 1) }) { Text("−") }
                            Text(
                                text = "${state.vibrationIntervalMinutes} min",
                                style = MaterialTheme.typography.titleMedium,
                                modifier = Modifier.padding(horizontal = 12.dp),
                            )
                            CompactButton(onClick = { viewModel.setVibrationInterval(state.vibrationIntervalMinutes + 1) }) { Text("+") }
                        }
                    }
                }

                // Exact-alarm permission fallback
                if (!state.canScheduleExact) {
                    item {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = "Alarms may be delayed. Allow exact alarms for on-time buzzes.",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.error,
                                textAlign = TextAlign.Center,
                            )
                            CompactButton(onClick = {
                                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                                    runCatching {
                                        context.startActivity(
                                            Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                                                .setData(android.net.Uri.parse("package:${context.packageName}"))
                                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                                        )
                                    }
                                }
                            }) { Text("Allow") }
                        }
                    }
                }
            }
        }
    }
}
