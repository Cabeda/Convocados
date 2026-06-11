package dev.convocados.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.convocados.ui.theme.Spacing

/**
 * Standard surface card used across screens. Replaces repeated
 * `Card(colors = CardDefaults.cardColors(containerColor = surface))` blocks.
 */
@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    contentPadding: androidx.compose.ui.unit.Dp = Spacing.md,
    content: @Composable () -> Unit,
) {
    val colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    if (onClick != null) {
        Card(onClick = onClick, colors = colors, modifier = modifier.fillMaxWidth()) {
            Column(Modifier.padding(contentPadding)) { content() }
        }
    } else {
        Card(colors = colors, modifier = modifier.fillMaxWidth()) {
            Column(Modifier.padding(contentPadding)) { content() }
        }
    }
}

/**
 * Section title with M3 typography + heading semantics for accessibility.
 */
@Composable
fun SectionHeader(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        color = MaterialTheme.colorScheme.primary,
        style = MaterialTheme.typography.labelMedium,
        modifier = modifier
            .padding(top = Spacing.lg, bottom = Spacing.sm)
            .semantics { heading() },
    )
}

/**
 * Stat tile (label + value) used in stats / profile / payments summaries.
 */
@Composable
fun StatTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = modifier,
    ) {
        Column(
            Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(value, color = valueColor, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
            Text(label, color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center)
        }
    }
}

/**
 * Row of evenly-weighted stat tiles.
 */
@Composable
fun StatRow(tiles: List<Pair<String, String>>, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        tiles.forEach { (label, value) ->
            StatTile(label = label, value = value, modifier = Modifier.weight(1f))
        }
    }
}
