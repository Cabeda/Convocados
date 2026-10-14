package dev.convocados.wear.ui.screen.score

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.PathMeasure
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import kotlin.math.abs
import kotlin.math.hypot

/**
 * `GameEdgeProgress` draws the ring around the game, so its outline has to be
 * the device's own outline: a perfect circle on a round watch, a sharp square
 * on a square one. Before this, the outline was a rounded rectangle with a
 * hard-coded 28dp corner radius on every non-round display — a shape no watch
 * actually has — and on a round display it only collapsed into a circle when
 * the canvas happened to be square, because the corner radius was derived from
 * the *shorter* side of the canvas rather than from the device.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class GameEdgeProgressShapeTest {

    private fun sampledPoints(path: androidx.compose.ui.graphics.Path, samples: Int = 4000): List<Offset> {
        val measure = PathMeasure().apply { setPath(path, false) }
        return (0..samples).map { i -> measure.getPosition(measure.length * i / samples) }
    }

    @Test
    fun roundDisplayDrawsAPerfectCircle() {
        val bounds = Rect(0f, 0f, 300f, 300f)
        val points = sampledPoints(edgeProgressPath(bounds, isRound = true))
        val centre = Offset(bounds.center.x, bounds.center.y)
        val radius = minOf(bounds.width, bounds.height) / 2f
        val offenders = points.filter { abs(hypot(it.x - centre.x, it.y - centre.y) - radius) > 0.75f }
        assertTrue(
            "%d of %d sampled points are not on the %.1fpx circle — the ring around the game is " +
                "not following the round display's outline"
                .format(offenders.size, points.size, radius),
            offenders.isEmpty(),
        )
    }

    /**
     * A round canvas that is not square is where the old rounded-rectangle
     * outline turned into a stadium instead of a circle.
     */
    @Test
    fun roundDisplayWithANonSquareCanvasIsStillACircle() {
        val bounds = Rect(0f, 0f, 320f, 260f)
        val points = sampledPoints(edgeProgressPath(bounds, isRound = true))
        val centre = Offset(bounds.center.x, bounds.center.y)
        val radius = minOf(bounds.width, bounds.height) / 2f
        val offenders = points.filter { abs(hypot(it.x - centre.x, it.y - centre.y) - radius) > 0.75f }
        assertTrue(
            "%d of %d sampled points stray from the %.1fpx circle on a %dx%d canvas — the ring " +
                "must stay a perfect circle whatever shape the canvas is"
                .format(offenders.size, points.size, radius, bounds.width, bounds.height),
            offenders.isEmpty(),
        )
    }

    @Test
    fun squareDisplayDrawsASquare() {
        val bounds = Rect(0f, 0f, 300f, 300f)
        val points = sampledPoints(edgeProgressPath(bounds, isRound = false))
        listOf(
            Offset(bounds.left, bounds.top),
            Offset(bounds.right, bounds.top),
            Offset(bounds.left, bounds.bottom),
            Offset(bounds.right, bounds.bottom),
        ).forEach { corner ->
            val nearest = points.minBy { hypot(it.x - corner.x, it.y - corner.y) }
            val distance = hypot(nearest.x - corner.x, nearest.y - corner.y)
            assertTrue(
                "the nearest ring point to corner %s is %.1fpx away — a square display must get a " +
                    "square outline, not one with an invented corner radius".format(corner, distance),
                distance <= 1f,
            )
        }
    }

    /** The square outline must not run outside the bounds it was given. */
    @Test
    fun squareOutlineStaysInsideItsBounds() {
        val bounds = Rect(0f, 0f, 300f, 300f)
        val points = sampledPoints(edgeProgressPath(bounds, isRound = false))
        val tolerance = 0.5f
        val outside = points.filter {
            it.x < bounds.left - tolerance || it.x > bounds.right + tolerance ||
                it.y < bounds.top - tolerance || it.y > bounds.bottom + tolerance
        }
        assertTrue(
            "%d of %d points fall outside %s".format(outside.size, points.size, bounds),
            outside.isEmpty(),
        )
    }
}
