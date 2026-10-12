package dev.convocados.wear.ui

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Minimum size, in either dimension, for any control the user is expected to
 * tap on a Wear display.
 *
 * Wear is driven by a fingertip on a small, often moving, target — the
 * platform's guidance is a 48dp minimum for interactive elements, and Material
 * 3 for Wear's own `Button` (52dp) and `IconButton` (52dp) already clear it.
 * `CompactButton` (32dp) does not, and is only appropriate for controls the
 * user is meant to *notice*, not to *hit*: the moment a control carries a real
 * action it has to reach this floor.
 *
 * Both dimensions count. A full-width row is tall enough but a stepper button
 * is narrow, so a height-only check lets a 33dp-wide `+` through.
 */
val MIN_TOUCH_TARGET: Dp = 48.dp

/**
 * Height a control carrying a *primary* action must reach.
 *
 * Matches Material 3 for Wear's `Button`, so promoting a `CompactButton` to a
 * `Button` satisfies it for free. Kept as a named value so screens do not
 * restate the library's number, and so a screen that sizes a custom control
 * (a chip, a roster row) has one place to take the height from.
 */
val PRIMARY_CONTROL_HEIGHT: Dp = 52.dp
