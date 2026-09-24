package dev.convocados.wear.ui

import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

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
 * Constrains width to [fraction] on round displays so a wide control placed
 * near the bezel is never clipped. No-op on square displays.
 */
@Composable
fun Modifier.roundSafeWidth(fraction: Float = ROUND_SAFE_FRACTION): Modifier =
    if (LocalConfiguration.current.isScreenRound) fillMaxWidth(fraction) else this

/**
 * Constrains the whole composable to the round display's safe (inscribed)
 * square, centered by the parent, so nothing lands under the bezel. No-op on
 * square displays.
 */
@Composable
fun Modifier.roundSafeSize(fraction: Float = ROUND_SAFE_FRACTION): Modifier =
    if (LocalConfiguration.current.isScreenRound) fillMaxSize(fraction) else fillMaxSize()

/**
 * For content centered on the equator: nearly full width (circle is widest
 * there) with the height still limited to the inscribed vertical band so
 * top/bottom overlays stay clear. Square keeps the previous full-bleed size.
 */
@Composable
fun Modifier.roundEquatorSize(
    widthFraction: Float = ROUND_EQUATOR_FRACTION,
    heightFraction: Float = ROUND_SAFE_FRACTION,
): Modifier =
    if (LocalConfiguration.current.isScreenRound) {
        fillMaxWidth(widthFraction).fillMaxHeight(heightFraction)
    } else {
        fillMaxSize()
    }

/**
 * Horizontal inset for full-width rows on round displays. Applied to list
 * items (chips, buttons, switches) that would otherwise bleed past the
 * circular bezel. No-op on square displays.
 */
@Composable
fun Modifier.roundListInset(horizontal: Dp = ROUND_LIST_INSET): Modifier =
    if (LocalConfiguration.current.isScreenRound) padding(horizontal = horizontal) else this

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
        padding(8.dp).clip(CircleShape)
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
