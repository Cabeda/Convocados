package dev.convocados.wear.data.ongoing

import org.junit.Assert.*
import org.junit.Test

class OngoingGameStatusTest {

    @Test
    fun `live ongoing shows when history active and not ended`() {
        assertTrue(OngoingGameStatus.shouldShowLiveOngoing(isLoading = false, hasHistory = true, gameEnded = false))
    }

    @Test
    fun `live ongoing hidden while loading`() {
        assertFalse(OngoingGameStatus.shouldShowLiveOngoing(isLoading = true, hasHistory = true, gameEnded = false))
    }

    @Test
    fun `live ongoing hidden without history`() {
        assertFalse(OngoingGameStatus.shouldShowLiveOngoing(isLoading = false, hasHistory = false, gameEnded = false))
    }

    @Test
    fun `live ongoing hidden when game ended`() {
        assertFalse(OngoingGameStatus.shouldShowLiveOngoing(isLoading = false, hasHistory = true, gameEnded = true))
    }

    @Test
    fun `quick ongoing shows inside game window`() {
        val kickoff = 1_000_000L
        // 10 min into a 60 min game
        assertTrue(OngoingGameStatus.shouldShowQuickOngoing(kickoff, kickoff + 10 * 60_000L, 60))
    }

    @Test
    fun `quick ongoing hidden without kickoff`() {
        assertFalse(OngoingGameStatus.shouldShowQuickOngoing(null, 1_000_000L, 60))
    }

    @Test
    fun `quick ongoing hidden after window elapses`() {
        val kickoff = 1_000_000L
        assertFalse(OngoingGameStatus.shouldShowQuickOngoing(kickoff, kickoff + 61 * 60_000L, 60))
    }

    @Test
    fun `quick ongoing hidden before kickoff`() {
        val kickoff = 1_000_000L
        assertFalse(OngoingGameStatus.shouldShowQuickOngoing(kickoff, kickoff - 1_000L, 60))
    }

    @Test
    fun `score text formats both sides`() {
        assertEquals("3 – 2", OngoingGameStatus.formatScore(3, 2))
    }
}
