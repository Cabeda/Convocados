package dev.convocados.wear.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration

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
