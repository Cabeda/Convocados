package dev.convocados.wear.ui.preview

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import androidx.wear.compose.material3.*
import androidx.compose.foundation.layout.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.convocados.wear.ui.theme.ConvocadosWearTheme

/**
 * Preview composables for Wear OS screenshot generation.
 *
 * To generate screenshots:
 * 1. Open this file in Android Studio
 * 2. Use "Run Preview" or the Compose Preview panel
 * 3. Right-click preview → "Copy Image" or use screenshot testing
 *
 * Alternatively, run:
 *   ./gradlew :wear:updateDebugScreenshotTest (if using Compose Screenshot Testing)
 */

@Preview(
    device = "id:wearos_large_round",
    showSystemUi = true,
    showBackground = true,
    backgroundColor = 0xFF000000
)
@Composable
fun PreviewGamesScreen() {
    ConvocadosWearTheme {
        // Simulated games list
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            item {
                Text(
                    text = "Games",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 24.dp, bottom = 8.dp)
                )
            }
            item { GameChipPreview("Friday Futsal", "Sports Hall", "Tomorrow 20:00", "8/10") }
            item { GameChipPreview("Sunday Football", "City Park", "Sun 10:00", "14/14") }
            item { GameChipPreview("Wednesday Padel", "Padel Club", "Wed 19:30", "4/4") }
        }
    }
}

@Composable
private fun GameChipPreview(title: String, location: String, time: String, players: String) {
    Card(
        onClick = {},
        modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(text = title, style = MaterialTheme.typography.titleSmall)
            Text(
                text = "$location · $time",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "👥 $players",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

@Preview(
    device = "id:wearos_large_round",
    showSystemUi = true,
    showBackground = true,
    backgroundColor = 0xFF000000
)
@Composable
fun PreviewScoreScreen() {
    ConvocadosWearTheme {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = "Friday Futsal",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(8.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Team A", style = MaterialTheme.typography.labelSmall)
                    Text("3", style = MaterialTheme.typography.displayMedium)
                }
                Text(":", style = MaterialTheme.typography.displaySmall)
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Team B", style = MaterialTheme.typography.labelSmall)
                    Text("2", style = MaterialTheme.typography.displayMedium)
                }
            }
            Spacer(Modifier.height(12.dp))
            FilledTonalButton(onClick = {}) {
                Text("View Teams")
            }
        }
    }
}

@Preview(
    device = "id:wearos_large_round",
    showSystemUi = true,
    showBackground = true,
    backgroundColor = 0xFF000000
)
@Composable
fun PreviewTeamsScreen() {
    ConvocadosWearTheme {
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            item {
                Text(
                    text = "Teams",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 24.dp, bottom = 4.dp)
                )
            }
            item {
                Text(
                    text = "Team A",
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
            item { PlayerChipPreview("João") }
            item { PlayerChipPreview("Pedro") }
            item { PlayerChipPreview("Miguel") }
            item { PlayerChipPreview("André") }
            item {
                Text(
                    text = "Team B",
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.padding(top = 12.dp)
                )
            }
            item { PlayerChipPreview("Rui") }
            item { PlayerChipPreview("Tiago") }
            item { PlayerChipPreview("Bruno") }
            item { PlayerChipPreview("Carlos") }
        }
    }
}

@Composable
private fun PlayerChipPreview(name: String) {
    Text(
        text = "  • $name",
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 2.dp)
    )
}
