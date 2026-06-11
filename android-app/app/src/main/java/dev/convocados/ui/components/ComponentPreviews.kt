package dev.convocados.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import dev.convocados.ui.theme.ConvocadosTheme
import dev.convocados.ui.theme.Spacing

/**
 * Design-system previews. These render the shared, stateless components in
 * light + dark so designers/devs can iterate without building the app.
 *
 * Screen-level previews require extracting stateless `*Content` composables
 * from the `hiltViewModel()`-backed screens (tracked as follow-up).
 */
@Preview(name = "Components – Light", showBackground = true)
@Preview(name = "Components – Dark", showBackground = true, uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun ComponentLibraryPreview() {
    ConvocadosTheme {
        Surface {
            Column(Modifier.padding(Spacing.lg)) {
                SectionHeader("OVERVIEW")
                StatRow(
                    tiles = listOf("Games" to "42", "Wins" to "27", "Draws" to "5"),
                )
                SectionHeader("PER EVENT")
                SectionCard {
                    Text("Tuesday 5-a-side", style = MaterialTheme.typography.titleMedium)
                    Text("12 games · Rating 1180", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Preview(name = "StatTile", showBackground = true)
@Composable
private fun StatTilePreview() {
    ConvocadosTheme {
        Surface {
            StatTile(label = "Win Rate", value = "64%", modifier = Modifier.padding(Spacing.lg))
        }
    }
}
