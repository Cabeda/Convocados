package dev.convocados.wear.data.ongoing

/**
 * Pure decision logic for the Wear Ongoing Activity (Play quality gate:
 * "Missing ongoing activity"). Kept Android-free so it is unit-testable on
 * the JVM; [GameOngoingActivityManager] applies the result to the system.
 */
object OngoingGameStatus {
    const val LIVE_ONGOING_ID = 1001
    const val QUICK_ONGOING_ID = 1002
    const val CHANNEL_ID = "live_games"

    /** Live event scoring is ongoing while a history row exists and the game hasn't ended. */
    fun shouldShowLiveOngoing(isLoading: Boolean, hasHistory: Boolean, gameEnded: Boolean): Boolean =
        !isLoading && hasHistory && !gameEnded

    /** Quick game is ongoing while now is inside [kickoff, kickoff + duration]. */
    fun shouldShowQuickOngoing(kickoffEpochMs: Long?, nowMs: Long, durationMinutes: Int): Boolean {
        val kickoff = kickoffEpochMs ?: return false
        if (durationMinutes <= 0) return false
        return nowMs in kickoff..(kickoff + durationMinutes * 60_000L)
    }

    fun formatScore(scoreOne: Int, scoreTwo: Int): String = "$scoreOne – $scoreTwo"
}
