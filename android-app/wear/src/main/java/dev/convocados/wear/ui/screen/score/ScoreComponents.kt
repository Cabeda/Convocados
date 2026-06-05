package dev.convocados.wear.ui.screen.score

import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text

/**
 * A full-height team tile: tap to add a point, long-press to subtract one.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun TeamScoreButton(
    teamName: String,
    score: Int,
    container: Color,
    contentColor: Color,
    onIncrement: () -> Unit,
    onDecrement: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    val view = LocalView.current
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed && enabled) 0.97f else 1f, label = "press")
    Column(
        modifier = modifier
            .scale(scale)
            .fillMaxHeight()
            .clip(RoundedCornerShape(28.dp))
            .background(container)
            .combinedClickable(
                interactionSource = interactionSource,
                indication = null,
                enabled = enabled,
                onClickLabel = "Add a point to $teamName",
                onLongClickLabel = "Remove a point from $teamName",
                onClick = {
                    view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                    onIncrement()
                },
                onLongClick = {
                    view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                    onDecrement()
                },
            )
            .semantics { contentDescription = "$teamName, $score points" }
            .padding(horizontal = 6.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = teamName,
            style = MaterialTheme.typography.titleSmall,
            color = contentColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
        Text(
            text = "$score",
            style = MaterialTheme.typography.displayLarge.copy(
                fontSize = 44.sp,
                fontWeight = FontWeight.Bold,
            ),
            color = contentColor,
        )
    }
}

/** Game-progress indicator that hugs the screen edge, starting at 12 o'clock. */
@Composable
internal fun GameEdgeProgress(progress: Float, modifier: Modifier = Modifier) {
    if (progress <= 0f) return

    val isRound = LocalConfiguration.current.isScreenRound
    val fillColor = MaterialTheme.colorScheme.primary
    val trackColor = MaterialTheme.colorScheme.surfaceContainer
    val tickColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)

    Canvas(modifier = modifier.fillMaxSize()) {
        val stroke = 5.dp.toPx()
        val left = stroke / 2f + 1.dp.toPx()
        val top = left
        val right = size.width - left
        val bottom = size.height - top
        val w = right - left
        val h = bottom - top
        val r = if (isRound) minOf(w, h) / 2f else 28.dp.toPx()
        val cx = left + w / 2f

        val path = Path().apply {
            moveTo(cx, top)
            lineTo(right - r, top)
            arcTo(Rect(right - 2 * r, top, right, top + 2 * r), -90f, 90f, false)
            lineTo(right, bottom - r)
            arcTo(Rect(right - 2 * r, bottom - 2 * r, right, bottom), 0f, 90f, false)
            lineTo(left + r, bottom)
            arcTo(Rect(left, bottom - 2 * r, left + 2 * r, bottom), 90f, 90f, false)
            lineTo(left, top + r)
            arcTo(Rect(left, top, left + 2 * r, top + 2 * r), 180f, 90f, false)
            close()
        }

        drawPath(path, trackColor, style = Stroke(width = stroke))

        val measure = PathMeasure().apply { setPath(path, false) }
        val ticks = 12
        for (i in 0 until ticks) {
            drawCircle(tickColor, radius = 1.5.dp.toPx(), center = measure.getPosition(measure.length * i / ticks))
        }

        val segment = Path()
        measure.getSegment(0f, measure.length * progress.coerceIn(0f, 1f), segment, true)
        drawPath(segment, fillColor, style = Stroke(width = stroke, cap = StrokeCap.Round))
    }
}

/** Lightweight elapsed-time pill (m:ss). */
@Composable
internal fun GameClock(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurface,
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(horizontal = 10.dp, vertical = 2.dp),
    )
}
