package dev.convocados.wear.util

import org.junit.Assert.*
import org.junit.Test

class PullToRefreshProgressTest {

    // Calibration mirroring the Wear screen: threshold 48dp, resistance 0.75.
    // A single deliberate pull (~64dp) triggers refresh.
    private val progress = PullToRefreshProgress(threshold = 48f, resistance = 0.75f)

    @Test
    fun `single pull above threshold triggers refresh exactly once`() {
        // 64dp of pull -> 64 * 0.75 / 48 = 1.0
        val triggered = progress.onScroll(64f)
        assertTrue(triggered)
        assertFalse("must not re-trigger while latched", progress.onScroll(10f))
    }

    @Test
    fun `short partial pulls accumulate across gestures`() {
        assertFalse(progress.onScroll(24f)) // 24 * 0.75 / 48 = 0.375
        assertFalse(progress.onScroll(20f)) // 0.375 + 0.3125 = 0.6875
        assertTrue(progress.onScroll(20f)) // crosses 1.0
    }

    @Test
    fun `cancelling without reaching threshold resets progress`() {
        assertFalse(progress.onScroll(20f))
        progress.reset()
        assertFalse(progress.onScroll(20f))
        assertEquals(0.3125f, progress.progress(), 0.001f)
    }

    @Test
    fun `scrolling back up resets accumulated progress`() {
        assertFalse(progress.onScroll(30f))
        assertFalse(progress.onScroll(-5f))
        assertEquals(0f, progress.progress(), 0.001f)
        assertFalse(progress.onScroll(30f)) // starts over, still below threshold
    }

    @Test
    fun `delta just under threshold does not trigger`() {
        assertFalse(progress.onScroll(63f)) // 63 * 0.75 / 48 = 0.984
    }
}
