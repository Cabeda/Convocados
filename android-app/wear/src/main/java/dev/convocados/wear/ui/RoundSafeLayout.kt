package dev.convocados.wear.ui

import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Fraction of the display that stays inside the round bezel for content that
 * reaches the top or bottom of the screen.
 *
 * A full-width control sitting near the top/bottom of a circular display has
 * its corners cut by the bezel, which Play flags under the "Watch shapes"
 * quality gate. The largest square that fits entirely inside a circle has a
 * side of `1 / sqrt(2) ~= 0.707` of the diameter; 0.72 keeps a hair of margin.
 */
const val ROUND_SAFE_FRACTION = 0.72f

/**
 * Width fraction for content vertically centered at the circle's equator,
 * where the display is widest. The inscribed-square [ROUND_SAFE_FRACTION]
 * leaves large dead margins there ("square inside a circle"). 0.95 fills the
 * usable width while keeping anti-aliasing clear of the bezel.
 */
const val ROUND_EQUATOR_FRACTION = 0.95f

/**
 * Horizontal inset applied to full-width list rows on round displays so
 * chips/buttons never cross the circular bezel at any scroll position.
 * No-op on square displays.
 */
val ROUND_LIST_INSET: Dp = 20.dp

/**
 * How far inside the bezel clip the edge-progress ring is drawn, so tiles can
 * be sized to the ring rather than to the clip and stay inside what the player
 * sees as the edge.
 */
internal val EDGE_PROGRESS_RING_INSET = 3.5.dp

/**
 * Inset that [roundBezelClip] applies before clipping to a circle, so content
 * laid out against the screen edge has to live inside a circle of
 * `min(side) / 2 - ROUND_BEZEL_INSET`. Internal rather than private because the
 * bezel-containment tests have to measure the very same circle.
 */
internal val ROUND_BEZEL_INSET = 8.dp

/**
 * Constrains width to [fraction] on round displays so a wide control placed
 * near the bezel is never clipped. No-op on square displays.
 */
@Composable
fun Modifier.roundSafeWidth(fraction: Float = ROUND_SAFE_FRACTION): Modifier =
    if (LocalConfiguration.current.isScreenRound) fillMaxWidth(fraction) else this

/**
 * For content centered on the equator: nearly full width (circle is widest
 * there) with the height capped at the inscribed rectangle for that width, so
 * the block's corners stay inside the circular bezel clip on every round
 * display size. Square keeps the previous full-bleed size.
 *
 * [inset] is the bezel-safe padding the caller wants around its content; the
 * inscribed rectangle is measured on that inner rectangle, because that is the
 * part the user sees against the bezel.
 */
@Composable
fun Modifier.roundEquatorSize(
    widthFraction: Float = ROUND_EQUATOR_FRACTION,
    heightFraction: Float = ROUND_SAFE_FRACTION,
    inset: Dp = 0.dp,
): Modifier {
    val configuration = LocalConfiguration.current
    if (!configuration.isScreenRound) return fillMaxSize().padding(inset)
    val bezelRadius =
        minOf(configuration.screenWidthDp, configuration.screenHeightDp).dp / 2f - ROUND_BEZEL_INSET
    return equatorInscribedSize(bezelRadius, widthFraction, heightFraction, inset)
}

/**
 * Sizes a centred block to the **largest rectangle the circle still allows** in
 * the vertical band the caller's overlays leave free.
 *
 * The block it replaces capped width at [ROUND_EQUATOR_FRACTION] and then asked
 * the circle for whatever height that width permitted. Those two decisions pull
 * against each other: a near-full-width block *cannot* be tall inside a circle,
 * so the score tiles came out short and wide, floating in dead bands above and
 * below while the display's own shape went unused. Sizing it the other way
 * round — take the band, then the widest the circle allows at that band's far
 * edge — gives the block the area the display actually has to give.
 *
 * [topReserve] and [bottomReserve] are the bands the overlays own: the 12-o'clock
 * hint (or the Finish button) above, the clock pill below. No-op on square
 * displays, where the caller's Row already fills the screen.
 */
@Composable
fun Modifier.roundScoreTilesSize(topReserve: Dp, bottomReserve: Dp): Modifier {
    val configuration = LocalConfiguration.current
    if (!configuration.isScreenRound) return fillMaxSize()
    // Sized to the display's bezel circle, less the ring's stroke inset — the
    // circle the edge-progress ring traces. The tiles are drawn in a container
    // that is shorter than the clipped area (scoreContentPadding keeps the
    // scaffold's vertical padding), so min(container)/2 is a *smaller* circle
    // than the ring's and would leave the tiles floating inside it.
    val bezelRadius =
        minOf(configuration.screenWidthDp, configuration.screenHeightDp).dp / 2f -
            ROUND_BEZEL_INSET - EDGE_PROGRESS_RING_INSET
    return scoreTilesBandSize(bezelRadius, topReserve, bottomReserve)
}

private fun Modifier.scoreTilesBandSize(
    bezelRadius: Dp,
    topReserve: Dp,
    bottomReserve: Dp,
): Modifier = layout { measurable, constraints ->
    val width = constraints.maxWidth
    val height = constraints.maxHeight
    val radius = bezelRadius.toPx()
    val top = topReserve.roundToPx()
    val bottom = height - bottomReserve.roundToPx()
    val bandHeight = (bottom - top).coerceAtLeast(0)

    // The largest rectangle inside a circle is the square of side r*sqrt(2),
    // and it is also the one with the most area. Take it whenever the overlay
    // band is tall enough, centred.
    val squareSide = (radius * sqrt(2f)).roundToInt()
    if (bandHeight >= squareSide && squareSide <= minOf(width, height)) {
        val blockTop = (height - squareSide) / 2
        val placeable = measurable.measure(Constraints.fixed(squareSide, squareSide))
        return@layout layout(width, height) {
            placeable.placeRelative((width - squareSide) / 2, blockTop)
        }
    }

    // Otherwise the band binds: the widest rectangle the circle allows at the
    // band's far edge, which is what keeps the corners on the circle.
    val centreY = height / 2f
    val yFar = maxOf(abs(top - centreY), abs(bottom - centreY))
    val under = radius * radius - yFar * yFar
    val halfWidth = if (under <= 0f) 0f else sqrt(under)
    val blockWidth = (halfWidth * 2f).roundToInt().coerceIn(0, width)
    val placeable = measurable.measure(Constraints.fixed(blockWidth, bandHeight))
    layout(width, height) { placeable.placeRelative((width - blockWidth) / 2, top) }
}

/**
 * Lays the child out at [widthFraction] of the available width, no taller than
 * the rectangle that fits inside the [bezelRadius] circle, inset by [inset].
 */
private fun Modifier.equatorInscribedSize(
    bezelRadius: Dp,
    widthFraction: Float,
    heightFraction: Float,
    inset: Dp,
) = this.layout { measurable, constraints ->
    val insetPx = inset.roundToPx()
    val width = (constraints.maxWidth * widthFraction).roundToInt()
    val contentWidth = (width - 2 * insetPx).coerceAtLeast(0)
    // A contentWidth x contentHeight rectangle only fits inside the circle
    // while (contentWidth/2)^2 + (contentHeight/2)^2 <= radius^2.
    val halfWidth = contentWidth / 2f
    val radius = bezelRadius.toPx()
    val inscribedHeight =
        if (halfWidth >= radius) 0 else (2f * sqrt(radius * radius - halfWidth * halfWidth)).roundToInt()
    val height = minOf(
        (constraints.maxHeight * heightFraction).roundToInt(),
        inscribedHeight + 2 * insetPx,
    ).coerceAtMost(constraints.maxHeight)
    val placeable = measurable.measure(Constraints.fixed(contentWidth, height - 2 * insetPx))
    layout(width, height) { placeable.placeRelative(insetPx, insetPx) }
}

/**
 * Horizontal inset for full-width rows on round displays. Applied to list
 * items (chips, buttons, switches) that would otherwise bleed past the
 * circular bezel. No-op on square displays.
 *
 * The inset is a function of **where the row sits on the circle**, not a flat
 * constant. A row at the equator may run nearly to the bezel because the circle
 * is widest there; the same row near the top of the display has to give up
 * width because the circle has already closed in. A flat [ROUND_LIST_INSET]
 * paid the pole price everywhere, so the equator row was left on the table and
 * the pole row still crossed the bezel.
 *
 * [horizontal] is the inset used when the row's position is not known yet (the
 * first layout pass) and when the row's corners are already entirely outside
 * the circle, where no inset can keep it inside. It is no longer what a row
 * actually gets at any stable scroll position.
 *
 * The row is assumed to be horizontally centred on the display — true of every
 * list these screens build — so only its vertical extent enters the geometry.
 */
@Composable
fun Modifier.roundListInset(horizontal: Dp = ROUND_LIST_INSET): Modifier {
    val configuration = LocalConfiguration.current
    if (!configuration.isScreenRound) return this

    // Written by onGloballyPositioned, read by the measure pass. A state read
    // in layout invalidates that node's layout only, so a scroll frame costs a
    // relayout of the row rather than a recomposition. Only the vertical bounds
    // are tracked: horizontal padding is what this modifier applies, so reading
    // the width back would make the measurement depend on its own result.
    val rowTop = remember { mutableStateOf<Float?>(null) }
    val rowBottom = remember { mutableStateOf<Float?>(null) }

    return this
        .onGloballyPositioned { coordinates ->
            val bounds = coordinates.boundsInRoot()
            val top = rowTop.value
            // The row's bottom edge is its top plus its height, and its height
            // is a function of the width this modifier computes — recording it
            // unconditionally closes a loop (inset -> width -> wrap -> height ->
            // inset) that a text row never settles out of, which is how
            // `waitForIdle` ends up polling for 60s. Both edges are only taken
            // while the row is genuinely moving; between moves the measured
            // height cannot change, because the inset cannot change.
            if (top == null || abs(top - bounds.top) > 0.5f) {
                // The row moved, so this is its position rather than a
                // consequence of the width we just chose: take both edges.
                rowTop.value = bounds.top
                rowBottom.value = bounds.bottom
            } else if (rowBottom.value == null || bounds.bottom > rowBottom.value!! + 0.5f) {
                // The row grew while staying put. Its height is a function of
                // the width this modifier computes, so a shrink here is the
                // feedback direction — accepting it re-opens the settle loop
                // (inset -> width -> wrap -> height -> inset) that left
                // `waitForIdle` polling for 60s. Growth is accepted because it
                // only ever asks for a *narrower* row, and the touch-target
                // floor bounds how far that can run, so the sequence settles.
                rowBottom.value = bounds.bottom
            }
        }
        .roundListInsetLayout(
            fallback = horizontal,
            screenWidthDp = configuration.screenWidthDp,
            screenHeightDp = configuration.screenHeightDp,
            rowTop = rowTop,
            rowBottom = rowBottom,
        )
}

/**
 * The measure pass for [roundListInset]: size the row the way plain horizontal
 * padding would, but with the horizontal padding derived from the row's
 * vertical position in the circle.
 */
private fun Modifier.roundListInsetLayout(
    fallback: Dp,
    screenWidthDp: Int,
    screenHeightDp: Int,
    rowTop: State<Float?>,
    rowBottom: State<Float?>,
): Modifier = layout { measurable, constraints ->
    val width = constraints.maxWidth
    val fallbackPx = fallback.roundToPx()
    val top = rowTop.value
    val bottom = rowBottom.value
    val inset = if (top == null || bottom == null || width == Constraints.Infinity) {
        fallbackPx
    } else {
        positionAwareInsetPx(
            width = width,
            rowTop = top,
            rowBottom = bottom,
            displayWidthPx = screenWidthDp * density,
            displayHeightPx = screenHeightDp * density,
            bezelInsetPx = ROUND_BEZEL_INSET.roundToPx(),
            fallbackPx = fallbackPx,
            minContentWidthPx = MIN_TOUCH_TARGET.toPx(),
        )
    }
    // Keep the caller's minimum width minus the inset, exactly as plain
    // horizontal padding does. Dropping it to zero lets a `fillMaxWidth()`
    // child — every row on these screens — size itself to its label and drift
    // back to a content-sized pill, which is the width regression the flat
    // inset never had.
    val childMin = (constraints.minWidth - 2 * inset).coerceAtLeast(0)
    val childMax = (width - 2 * inset).coerceAtLeast(0)
    val placeable = measurable.measure(
        constraints.copy(minWidth = childMin, maxWidth = childMax),
    )
    val nodeWidth = (placeable.width + 2 * inset).coerceIn(constraints.minWidth, width)
    // A child that sized itself to its content would otherwise sit hard against
    // the row's left edge, which is not where a round list puts anything and is
    // not what the geometry above assumes — the formula measures the row about
    // the display centre, so the child has to sit there too.
    val childX = ((nodeWidth - placeable.width) / 2f).roundToInt()
    layout(nodeWidth, placeable.height) { placeable.placeRelative(childX, 0) }
}

/**
 * The horizontal padding a row of width [width] needs so that its corners stay
 * inside a circle of `min(display) / 2 - bezelInset`.
 *
 * The row spans `[-width/2, width/2]` about the display centre and
 * `[rowTop, rowBottom]` vertically, so its farthest corner sits at
 * `sqrt(halfWidth² + yFar²)`. Solving for the half width the circle still
 * allows at that height gives the inset.
 *
 * The result is capped so the row never falls below
 * [MIN_TOUCH_TARGET][dev.convocados.wear.ui.MIN_TOUCH_TARGET] wide: the circle
 * asks for more and more width the closer the row gets to a pole, and past a
 * point it would ask for a row too narrow to press. The floor is what wins
 * there, and the bezel clip does what it already did. Everywhere the circle can
 * still accommodate a pressable row, the row follows it exactly — which is the
 * whole point: the silhouette around the game is the device's shape, not a
 * flat band floating inside it. Once the row's far edge passes the circle no
 * inset fits at all, and [fallbackPx] applies for the same reason.
 */
internal fun positionAwareInsetPx(
    width: Int,
    rowTop: Float,
    rowBottom: Float,
    displayWidthPx: Float,
    displayHeightPx: Float,
    bezelInsetPx: Int,
    fallbackPx: Int = 0,
    minContentWidthPx: Float = 0f,
): Int {
    val centreY = displayHeightPx / 2f
    val yFar = maxOf(abs(rowTop - centreY), abs(rowBottom - centreY))
    val radius = minOf(displayWidthPx, displayHeightPx) / 2f - bezelInsetPx
    // Two ceilings on how far the geometry may push a row in:
    //
    // * the touch-target floor — the narrowest row a finger can still hit;
    // * the flat inset the screens used before this was position-aware, so a
    //   pole row keeps exactly the width it has today. Left to the circle
    //   alone a pole row collapses to the floor, which on a 227dp watch turns
    //   a choice label into four stacked letters — geometrically right and
    //   unusable. The poles therefore keep their old width and their old
    //   relationship with the bezel clip, and only the band where the circle
    //   has room to spare gains anything.
    val floorInset = ((width - minContentWidthPx) / 2f).coerceAtLeast(0f)
    val ceiling = minOf(floor(floorInset), fallbackPx.toFloat())
    val underTheCircle = radius * radius - yFar * yFar
    if (underTheCircle <= 0f) return ceiling.toInt()
    val allowedHalfWidth = sqrt(underTheCircle)
    val needed = (width / 2f - allowedHalfWidth).coerceAtLeast(0f)
    // Round the geometric inset *up*, so the row never lands a fraction outside
    // the circle, and the ceilings *down*, so neither is overshot by rounding.
    return minOf(ceil(needed), ceiling).toInt()
}

/**
 * How many lines a row's text may take, and what happens past them.
 *
 * Paired because the two only mean anything together: [maxLines] without an
 * [overflow] just cuts the text at the layout boundary, and an
 * [TextOverflow.Ellipsis] without [maxLines] never kicks in.
 */
data class RoundSafeTextLines(val maxLines: Int, val overflow: TextOverflow)

/**
 * The line budget for a row's text, round-aware.
 *
 * On a round display a long label can spill across the bezel, so it is clipped
 * to [roundLines] ellipsised lines. On a square display the inset such a row
 * also carries is a documented no-op, so the text wraps as written instead —
 * clipping it there would eat text that used to be readable (GH #1276, where
 * an ellipsis was added to every row, square displays included).
 *
 * A square display asks for the platform default (`Int.MAX_VALUE` lines,
 * `TextOverflow.Clip`), so passing this in changes nothing about a layout that
 * never clipped in the first place.
 */
@Composable
fun roundSafeTextLines(roundLines: Int = 1): RoundSafeTextLines =
    if (LocalConfiguration.current.isScreenRound) {
        RoundSafeTextLines(roundLines, TextOverflow.Ellipsis)
    } else {
        RoundSafeTextLines(Int.MAX_VALUE, TextOverflow.Clip)
    }

/**
 * Clips drawing to the circular display bounds on round screens so list
 * content (and anti-aliased edges / elevation shadows) never paints into the
 * dead corner areas the bezel cuts away. Inset slightly so the anti-aliased
 * clip edge itself stays inside the bezel-safe radius (0.97·r). No-op on
 * square displays.
 */
@Composable
fun Modifier.roundBezelClip(): Modifier =
    if (LocalConfiguration.current.isScreenRound) {
        padding(ROUND_BEZEL_INSET).clip(CircleShape)
    } else {
        this
    }

/**
 * Applies only the vertical portion of [ScreenScaffold] content padding on
 * round displays. Horizontal scaffold padding would shrink the equator-band
 * score tiles below the circular usable width; edge progress overlays need
 * the full width. Square keeps the full padding (unchanged layout).
 */
@Composable
fun Modifier.scoreContentPadding(
    padding: androidx.compose.foundation.layout.PaddingValues,
): Modifier =
    if (LocalConfiguration.current.isScreenRound) {
        padding(
            start = 0.dp,
            end = 0.dp,
            top = padding.calculateTopPadding(),
            bottom = padding.calculateBottomPadding(),
        )
    } else {
        padding(padding)
    }
