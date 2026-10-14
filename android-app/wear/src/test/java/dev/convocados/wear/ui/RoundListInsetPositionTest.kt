package dev.convocados.wear.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.math.abs
import kotlin.math.hypot

private const val POLE_ROW = "pole_row"
private const val EQUATOR_ROW = "equator_row"

/** Height every row in the fixture uses, so only position can differ. */
private val ROW_HEIGHT = 52.dp

/** Distance of the pole row's top edge below the top of the clipped display. */
private val POLE_ROW_TOP = 24.dp

/**
 * [roundListInset] used to be a flat [ROUND_LIST_INSET] applied to every row at
 * every height, so a list row paid the same price near the top of a round
 * display — where the circle has almost no width left — as it did at the
 * equator, where the display is at its widest. The row was neither as wide as
 * it could safely be in the middle nor as narrow as the circle demands at the
 * poles.
 *
 * The invariant under test: the inset is a function of the row's **position**.
 * Two rows of identical size on the same round display must not get the same
 * inset, and neither may put a corner outside the circular bezel.
 *
 * `w212dp-h212dp-round` is the qualifier of the physical watch this was written
 * against (Galaxy Watch4, `sw212dp`, 450px/340dpi) — smaller than the 227dp the
 * screenshot goldens assume, which is where a flat inset costs the most.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RoundListInsetPositionTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Composable
    private fun Fixture() {
        ConvocadosWearTheme {
            Box(Modifier.fillMaxSize().roundBezelClip()) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .align(Alignment.TopCenter)
                        .padding(top = POLE_ROW_TOP)
                        .roundListInset()
                        .fillMaxWidth()
                        .height(ROW_HEIGHT)
                        .testTag(POLE_ROW),
                )
                Box(
                    Modifier
                        .fillMaxWidth()
                        .align(Alignment.Center)
                        .roundListInset()
                        .fillMaxWidth()
                        .height(ROW_HEIGHT)
                        .testTag(EQUATOR_ROW),
                )
            }
        }
    }

    private fun setUp() {
        composeRule.setContent { Fixture() }
        composeRule.waitForIdle()
    }

    private fun boundsOf(tag: String): Rect =
        composeRule.onNode(hasTestTag(tag)).fetchSemanticsNode(tag).boundsInRoot

    /**
     * The equator row must be strictly wider than the pole row: if they measure
     * the same, the inset is still the flat constant it used to be.
     */
    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun equatorRowIsWiderThanPoleRow() {
        setUp()
        val pole = boundsOf(POLE_ROW)
        val equator = boundsOf(EQUATOR_ROW)
        assertTrue(
            ("pole row spans %.1fpx and equator row %.1fpx — a position-aware inset must give the " +
                "equator, where the circle is widest, more width than a row near the top")
                .format(pole.width, equator.width),
            equator.width > pole.width + 1f,
        )
    }

    /** The equator row must at least match what the old flat inset produced. */
    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun equatorRowBeatsTheOldFlatInset() {
        setUp()
        val display = composeRule.onRoot().fetchSemanticsNode().boundsInRoot
        val bezelInset = with(composeRule.density) { ROUND_BEZEL_INSET.toPx() }
        val flatInset = with(composeRule.density) { ROUND_LIST_INSET.toPx() }
        val legacyRowWidth = display.width - 2 * bezelInset - 2 * flatInset
        val equator = boundsOf(EQUATOR_ROW)
        assertTrue(
            ("equator row spans %.1fpx, the legacy flat inset gave %.1fpx — the change must not " +
                "shrink the widest row on the display")
                .format(equator.width, legacyRowWidth),
            equator.width >= legacyRowWidth - 1f,
        )
    }

    /**
     * The equator row is the one the circle has room for, so it is the one
     * that must stay inside the bezel. The pole row is capped at the flat
     * inset — deliberately no narrower than it was before, and therefore no
     * more inside the bezel than it was before either.
     */
    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun equatorRowStaysInsideTheBezelAndPoleRowKeepsItsWidth() {
        setUp()
        assertRowInsideBezel(EQUATOR_ROW, boundsOf(EQUATOR_ROW))
        assertPoleRowKeepsAtLeastTheFlatWidth()
    }

    /**
     * The physical watch. 212dp leaves the least room of any supported round
     * size, so this is the case a flat inset broke first.
     */
    @Test
    @Config(qualifiers = "w212dp-h212dp-round")
    fun positionAwareOnThe212dpWatch() {
        setUp()
        val pole = boundsOf(POLE_ROW)
        val equator = boundsOf(EQUATOR_ROW)
        assertTrue(
            ("on the 212dp watch the pole row spans %.1fpx and the equator row %.1fpx — they must " +
                "differ, or the inset is still flat")
                .format(pole.width, equator.width),
            equator.width > pole.width + 1f,
        )
        assertRowInsideBezel(EQUATOR_ROW, equator)
        assertPoleRowKeepsAtLeastTheFlatWidth()
    }

    /** On a square display the inset is a documented no-op: rows stay full width. */
    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun squareKeepsFullWidthRows() {
        setUp()
        val display = composeRule.onRoot().fetchSemanticsNode().boundsInRoot
        val pole = boundsOf(POLE_ROW)
        val equator = boundsOf(EQUATOR_ROW)
        val tolerance = 1f
        assertTrue(
            ("pole row spans %.1fpx and equator row %.1fpx on a square display — the two must " +
                "match, since roundListInset is a no-op there")
                .format(pole.width, equator.width),
            abs(pole.width - equator.width) <= tolerance,
        )
        assertTrue(
            "equator row spans %.1fpx of %.1fpx, expected full width on square"
                .format(equator.width, display.width),
            equator.width >= display.width - tolerance,
        )
    }

    /**
     * A row may only be wider than the flat inset made it if the circle had
     * room for that width, which is exactly when it stays inside the bezel.
     */
    private fun assertRowInsideBezel(tag: String, bounds: Rect) {
        val display = composeRule.onRoot().fetchSemanticsNode().boundsInRoot
        val radius = (minOf(display.width, display.height) / 2f) -
            with(composeRule.density) { ROUND_BEZEL_INSET.toPx() }
        val tolerance = 1.5f
        listOf(
            bounds.left to bounds.top,
            bounds.right to bounds.top,
            bounds.left to bounds.bottom,
            bounds.right to bounds.bottom,
        ).forEach { (x, y) ->
            val distance = hypot(x - display.center.x, y - display.center.y)
            assertTrue(
                ("%s corner (%.1f, %.1f) sits %.1fpx from the centre, outside the %.1fpx bezel " +
                    "radius — the position-aware inset widened a row the circle had no room for")
                    .format(tag, x, y, distance, radius),
                distance <= radius + tolerance,
            )
        }
    }

    /**
     * The pole row must come out no narrower than the flat inset gave it: the
     * ceiling is what stops the circle from squeezing a row down to the
     * touch-target floor and wrapping its label to pieces.
     */
    private fun assertPoleRowKeepsAtLeastTheFlatWidth() {
        val pole = boundsOf(POLE_ROW)
        val display = composeRule.onRoot().fetchSemanticsNode().boundsInRoot
        val bezelInset = with(composeRule.density) { ROUND_BEZEL_INSET.toPx() }
        val flatInset = with(composeRule.density) { ROUND_LIST_INSET.toPx() }
        val legacyWidth = display.width - 2 * bezelInset - 2 * flatInset
        assertTrue(
            ("pole row spans %.1fpx, the flat inset gave %.1fpx — the position-aware inset must " +
                "never make a row narrower than it already was")
                .format(pole.width, legacyWidth),
            pole.width >= legacyWidth - 1f,
        )
    }
}
