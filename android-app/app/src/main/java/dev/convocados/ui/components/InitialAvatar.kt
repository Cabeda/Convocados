package dev.convocados.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer

/**
 * First-initial placeholder centered on the glyph's ink box rather than the font's line
 * box. A plain [androidx.compose.material3.Text] inside `Box(Alignment.Center)` centers
 * the full line box, so the empty descender space below a capital shifts the letter
 * upward. Measuring the character bounds and placing the layout so those bounds land on
 * the container center keeps every glyph optically centered regardless of font metrics.
 */
@Composable
fun InitialAvatar(
    name: String,
    color: Color,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.labelSmall,
) {
    val initial = name.trim().take(1).uppercase()
    val textMeasurer: TextMeasurer = rememberTextMeasurer()
    val layout = remember(textMeasurer, initial, style) {
        textMeasurer.measure(AnnotatedString(initial), style = style)
    }
    val glyphBounds = if (initial.isEmpty()) null else layout.getBoundingBox(0)
    Canvas(
        modifier = modifier.semantics { contentDescription = name },
    ) {
        if (glyphBounds == null) return@Canvas
        drawText(
            textLayoutResult = layout,
            color = color,
            topLeft = Offset(
                x = size.width / 2f - glyphBounds.center.x,
                y = size.height / 2f - glyphBounds.center.y,
            ),
        )
    }
}
