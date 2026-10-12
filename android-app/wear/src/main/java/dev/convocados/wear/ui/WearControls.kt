package dev.convocados.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.FilledIconButton
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text

/**
 * The +/- control for a stepper (duration, alarm interval, kickoff nudge).
 *
 * A `CompactButton` here is 33dp wide and 32dp tall — two of the smallest
 * targets on the screen, wrapped around the only action that changes the
 * number. `FilledIconButton` is 52dp in both dimensions, which is what a
 * fingertip needs and what Material 3 for Wear already ships, so the glyph
 * stays the same and only the target grows.
 */
@Composable
fun WearStepButton(
    label: String,
    onClick: () -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    FilledIconButton(
        onClick = onClick,
        modifier = modifier.semantics { this.contentDescription = contentDescription },
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.titleMedium,
        )
    }
}

/**
 * A band of equal-width choices spanning the row's round-safe width.
 *
 * Three separately-sized pills on a 227dp round display overflow the bezel and
 * leave the outer two hard to hit; equal thirds always fit and always clear
 * [MIN_TOUCH_TARGET].
 */
@Composable
fun WearChoiceRow(
    modifier: Modifier = Modifier,
    arrangement: Arrangement.Horizontal = Arrangement.spacedBy(4.dp),
    verticalAlignment: Alignment.Vertical = Alignment.CenterVertically,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = arrangement,
        verticalAlignment = verticalAlignment,
        content = content,
    )
}
