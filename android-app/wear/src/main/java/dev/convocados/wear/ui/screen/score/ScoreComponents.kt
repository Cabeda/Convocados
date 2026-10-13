package dev.convocados.wear.ui.screen.score

import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.GenericShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.AnimatedText
import androidx.wear.compose.material3.LocalContentColor
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.rememberAnimatedTextFontRegistry
import dev.convocados.designsystem.ExpressiveMotion
import dev.convocados.designsystem.ExpressiveSemanticRole
import dev.convocados.wear.ui.theme.expressiveMotion
import dev.convocados.wear.ui.theme.expressiveTokens
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Interval between auto-repeats while a long-press is held (score decrement). */
private const val REPEAT_DECREMENT_DELAY_MS = 160L

/**
 * A full-height team tile: tap to add a point, long-press to subtract one.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
/**
 * The outline of one team's score tile.
 *
 * On a square display the tile is a square: the display's own shape, sharp
 * corners and all. On a round one the pair reads as the circle split down the
 * middle — the outer edge curves with the display, the edge on the midline
 * stays straight, so the two tiles together trace the ring they sit inside.
 *
 * [isLeft] picks which half: the left tile rounds its left edge, the right tile
 * its right. The radius is the tile's own height over two, clamped to its
 * width, so the curve is a true semicircle wherever the tile is tall enough and
 * a maximum-radius round otherwise.
 */
internal fun teamScoreTileShape(isRound: Boolean, isLeft: Boolean): Shape {
    if (!isRound) return RectangleShape
    return GenericShape { size, _ ->
        val radius = minOf(size.height / 2f, size.width)
        if (isLeft) {
            moveTo(size.width, 0f)
            lineTo(radius, 0f)
            arcTo(Rect(0f, 0f, radius * 2f, size.height), -90f, -180f, false)
            lineTo(size.width, size.height)
        } else {
            moveTo(0f, 0f)
            lineTo(size.width - radius, 0f)
            arcTo(Rect(size.width - radius * 2f, 0f, size.width, size.height), -90f, 180f, false)
            lineTo(0f, size.height)
        }
        close()
    }
}

@Composable
internal fun TeamScoreButton(
    teamName: String,
    score: Int,
    scoreLabel: String = score.toString(),
    container: Color,
    contentColor: Color,
    onIncrement: () -> Unit,
    onDecrement: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    shape: Shape = MaterialTheme.shapes.large,
) {
    val view = LocalView.current
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val motion = expressiveMotion()
    val scale by animateFloatAsState(
        targetValue = if (pressed && enabled) 0.97f else 1f,
        animationSpec = if (motion == ExpressiveMotion.Reduced) snap() else spring(),
        label = "press",
    )

    // Holding state shared between the long-press (repeat loop) and a pointer
    // watcher that tracks when the finger actually lifts, so a held long-press
    // keeps decrementing at a steady pace until release.
    val scope = rememberCoroutineScope()
    val holding = remember { mutableStateOf(false) }

    // Flex-font registry drives the score's "roll" on each point: weight + width
    // swell briefly so the tile feels responsive, using M3 Expressive AnimatedText.
    // Sizes come from MaterialTheme typography (round-optimized flex fonts),
    // not hard-coded sp, so the score tracks the Expressive type system.
    val scoreStartSize = MaterialTheme.typography.displaySmall.fontSize
    val scoreEndSize = MaterialTheme.typography.displayMedium.fontSize
    val fontRegistry = rememberAnimatedTextFontRegistry(
        startFontVariationSettings = FontVariation.Settings(
            FontVariation.width(60f),
            FontVariation.weight(600),
        ),
        endFontVariationSettings = FontVariation.Settings(
            FontVariation.width(100f),
            FontVariation.weight(800),
        ),
        startFontSize = scoreStartSize,
        endFontSize = scoreEndSize,
    )
    val scoreAnim = remember { Animatable(0f) }
    LaunchedEffect(score, scoreLabel, motion) {
        scoreAnim.snapTo(0f)
        if (motion == ExpressiveMotion.Expressive) {
            scoreAnim.animateTo(1f)
            scoreAnim.animateTo(0f)
        }
    }
    Column(
        modifier = modifier
            .scale(scale)
            .fillMaxHeight()
            // M3 Expressive shape from the theme (round-optimized), not a
            // hard-coded corner radius.
            .clip(shape)
            .background(container)
            .combinedClickable(
                interactionSource = interactionSource,
                // Default ripple (Expressive touch response) alongside the
                // press-scale above.
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
                    // Keep decrementing while the finger stays down.
                    scope.launch {
                        while (holding.value) {
                            delay(REPEAT_DECREMENT_DELAY_MS)
                            onDecrement()
                            view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                        }
                    }
                },
            )
            .pointerInput(Unit) {
                // Observe down/up without consuming, so the repeat loop above
                // knows when the hold ends.
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    holding.value = true
                    try {
                        waitForUpOrCancellation()
                    } finally {
                        holding.value = false
                    }
                }
            }
            .semantics { contentDescription = "$teamName, $scoreLabel" }
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
        CompositionLocalProvider(LocalContentColor provides contentColor) {
            AnimatedText(
                text = scoreLabel,
                fontRegistry = fontRegistry,
                progressFraction = { scoreAnim.value },
                modifier = Modifier.semantics { contentDescription = scoreLabel },
            )
        }
    }
}

/**
 * The outline the game-progress ring traces: the device's own display shape.
 *
 * On a round watch that is a **perfect circle**, inscribed in [bounds] and
 * centred on it — a rounded rectangle whose corner radius happens to equal
 * half the short side only collapses into a circle when the canvas is square,
 * so a non-square canvas used to yield a stadium instead. On a square watch it
 * is the display's rectangle itself, **sharp-cornered**: the old hard-coded
 * 28dp radius described no watch that exists.
 *
 * [bounds] is the canvas the ring is drawn into, which is the full display.
 */
internal fun edgeProgressPath(bounds: Rect, isRound: Boolean): Path = Path().apply {
    if (isRound) {
        val radius = minOf(bounds.width, bounds.height) / 2f
        addOval(
            Rect(
                bounds.center.x - radius,
                bounds.center.y - radius,
                bounds.center.x + radius,
                bounds.center.y + radius,
            ),
        )
    } else {
        moveTo(bounds.left, bounds.top)
        lineTo(bounds.right, bounds.top)
        lineTo(bounds.right, bounds.bottom)
        lineTo(bounds.left, bounds.bottom)
        close()
    }
}

/** Game-progress indicator that hugs the screen edge, starting at 12 o'clock. */
@Composable
internal fun GameEdgeProgress(
    progress: Float,
    modifier: Modifier = Modifier,
    alarmFractions: List<Float> = emptyList(),
    nextAlarmFraction: Float? = null,
) {
    if (progress <= 0f) return

    val isRound = LocalConfiguration.current.isScreenRound
    val fillColor = MaterialTheme.colorScheme.primary
    val trackColor = MaterialTheme.colorScheme.surfaceContainer
    val tickColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
    // Ticks sit *inside* the ring, so the outer silhouette stays a clean
    // circle and the ring's own progress is never buried under them. The base
    // colour is deliberately quiet: with a one-minute alarm on a 60-minute
    // game there are 60 of them, and only the next one earns attention.
    val alarmTickColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.55f)
    val passedTickColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.22f)
    val nextAlarmTickColor = MaterialTheme.colorScheme.primary
    val tokens = expressiveTokens()
    val endColor = tokens.colorFor(ExpressiveSemanticRole.Warning)

    Canvas(modifier = modifier.fillMaxSize()) {
        val stroke = 5.dp.toPx()
        val left = stroke / 2f + 1.dp.toPx()
        val top = left
        val right = size.width - left
        val bottom = size.height - top
        val w = right - left
        val h = bottom - top
        val cx = left + w / 2f
        val cy = top + h / 2f
        val path = edgeProgressPath(Rect(left, top, right, bottom), isRound)

        drawPath(path, trackColor, style = Stroke(width = stroke))

        val measure = PathMeasure().apply { setPath(path, false) }

        // Subtle reference dots (base ring). Alarm ticks render on top of these.
        val ticks = 12
        for (i in 0 until ticks) {
            drawCircle(tickColor, radius = 1.dp.toPx(), center = measure.getPosition(measure.length * i / ticks))
        }

        val center = Offset(cx, cy)
        // Room between the ring's inner edge and the canvas edge, so every mark
        // drawn inward stays clear of the bezel clip.
        val inwardFrom = stroke / 2f + 1.dp.toPx()

        // End-of-game notch at full time.
        val endPos = measure.getPosition(measure.length)
        drawRadialTick(
            center = center, pos = endPos, color = endColor,
            from = inwardFrom, to = inwardFrom + 9.dp.toPx(), width = 3.dp.toPx(),
        )

        // Alarm ticks: hairlines reaching inward, next one emphasised, passed
        // ones dimmed. Deliberately thinner than the ring they mark, so 60 of
        // them read as a fine toothed ring rather than a caterpillar.
        val nextTickLength = 7.dp.toPx()
        val tickLength = 4.dp.toPx()
        alarmFractions.forEach { f ->
            val pos = measure.getPosition(measure.length * f.coerceIn(0f, 1f))
            val isNext = f == nextAlarmFraction
            val color = when {
                isNext -> nextAlarmTickColor
                f < progress -> passedTickColor
                else -> alarmTickColor
            }
            drawRadialTick(
                center = center,
                pos = pos,
                color = color,
                from = inwardFrom,
                to = inwardFrom + if (isNext) nextTickLength else tickLength,
                width = if (isNext) 2.5.dp.toPx() else 1.5.dp.toPx(),
            )
        }

        val segment = Path()
        measure.getSegment(0f, measure.length * progress.coerceIn(0f, 1f), segment, true)
        drawPath(segment, fillColor, style = Stroke(width = stroke, cap = StrokeCap.Round))
    }
}

/**
 * A radial mark on the ring: a line from [from] to [to] pixels outwards from
 * [center] along the ray to [pos].
 *
 * [from] of `stroke / 2` is the ring's inner edge, so passing a larger [from]
 * starts the mark just inside the ring and [to] walks it inward — never back
 * out toward the bezel, where the round clip would cut it.
 */
private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawRadialTick(
    center: Offset,
    pos: Offset,
    color: Color,
    from: Float,
    to: Float,
    width: Float,
) {
    val dx = pos.x - center.x
    val dy = pos.y - center.y
    val norm = kotlin.math.sqrt(dx * dx + dy * dy)
    if (norm == 0f || to <= from) return
    val ux = dx / norm
    val uy = dy / norm
    // Positive offsets move *away* from the centre, so negating them walks in.
    val start = Offset(pos.x - ux * from, pos.y - uy * from)
    val end = Offset(pos.x - ux * to, pos.y - uy * to)
    drawLine(color, start, end, strokeWidth = width, cap = StrokeCap.Round)
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
