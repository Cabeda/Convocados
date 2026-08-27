package dev.convocados.wear.util

/**
 * Tracks pull-to-refresh progress toward a threshold.
 *
 * Progress accumulates across gestures (it is only reset when the user scrolls
 * back up or a refresh completes). This means a short pull followed by another
 * short pull still reaches the threshold — the Wear screen is too small for a
 * single gesture to cover a long threshold distance.
 */
class PullToRefreshProgress(
    private val threshold: Float,
    private val resistance: Float,
) {
    private var progress = 0f
    private var refreshTriggered = false

    /**
     * Records a scroll delta. Returns true exactly once, when the accumulated
     * progress first crosses the threshold (arms a refresh).
     *
     * @param delta positive = pull down, negative = scroll back up.
     */
    fun onScroll(delta: Float): Boolean {
        if (delta < 0f) {
            progress = 0f
            refreshTriggered = false
            return false
        }
        if (delta == 0f) return false
        // The ring fills slower than the finger so a deliberate pull is needed.
        progress = (progress + delta * resistance / threshold).coerceIn(0f, 1f)
        if (progress >= 1f && !refreshTriggered) {
            refreshTriggered = true
            return true
        }
        return false
    }

    /** The fraction of the threshold that has been pulled (0..1). */
    fun progress(): Float = progress

    /**
     * Resets the accumulated progress and releases the triggered latch.
     * Called when a refresh completes or the surface is dismissed.
     */
    fun reset() {
        progress = 0f
        refreshTriggered = false
    }
}
