package dev.convocados.wear.tile

import dev.convocados.wear.data.local.QUICK_SPORT_PADEL
import dev.convocados.wear.data.local.QuickGameState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickGameTileTest {

    private val kickoff = 1_000_000_000_000L
    private val hour = 60 * 60_000L

    private fun state(kickoffMs: Long? = null, duration: Int = 60) = QuickGameState(
        scoreOne = 3,
        scoreTwo = 2,
        sport = QUICK_SPORT_PADEL,
        durationMinutes = duration,
        kickoffEpochMs = kickoffMs,
    )

    @Test
    fun noKickoff_isIdle() {
        val data = quickGameTileData(state(), kickoff)
        assertEquals(QuickGameTileStatus.NONE, data.status)
        assertFalse(data.hasGame)
    }

    @Test
    fun insideWindow_isLive() {
        val started = state(kickoff)
        assertEquals(QuickGameTileStatus.LIVE, quickGameTileData(started, kickoff).status)
        assertEquals(QuickGameTileStatus.LIVE, quickGameTileData(started, kickoff + 30 * 60_000L).status)
        assertEquals(QuickGameTileStatus.LIVE, quickGameTileData(started, kickoff + hour).status)
    }

    @Test
    fun beforeKickoff_isUpcoming() {
        val started = state(kickoff)
        assertEquals(QuickGameTileStatus.UPCOMING, quickGameTileData(started, kickoff - 1).status)
        // The tap gate is LIVE-only, so an upcoming game is announced nowhere
        // else on the watch either: the tile stays the idle CTA.
        assertFalse(quickGameTileData(started, kickoff - 1).hasGame)
    }

    @Test
    fun afterWindow_isPaused() {
        val started = state(kickoff)
        assertEquals(QuickGameTileStatus.PAUSED, quickGameTileData(started, kickoff + hour + 1).status)
    }

    // GH #993 / dex pytzuddq — a finished game has no destination: the tap gate
    // is LIVE-only, the ongoing activity is already gone and the games list
    // hides the only "continue" CTA, so the tile must stop presenting a score
    // the tap cannot open.
    @Test
    fun afterWindow_presentsNoGame() {
        val data = quickGameTileData(state(kickoff), kickoff + hour + 1)
        assertEquals(QuickGameTileStatus.PAUSED, data.status)
        assertFalse("a finished score is a tap with nowhere to land", data.hasGame)
    }

    @Test
    fun insideWindow_presentsTheRunningGame() {
        assertTrue(quickGameTileData(state(kickoff), kickoff + 30 * 60_000L).hasGame)
        assertTrue(quickGameTileData(state(kickoff), kickoff + hour).hasGame)
    }

    @Test
    fun presentsContentExactlyWhileTheGameIsLive() {
        val started = state(kickoff)
        listOf(
            kickoff - hour to false,
            kickoff to true,
            kickoff + 30 * 60_000L to true,
            kickoff + hour to true,
            kickoff + hour + 1 to false,
            kickoff + 2 * hour to false,
        ).forEach { (now, presents) ->
            val data = quickGameTileData(started, now)
            assertEquals(
                "at ${now - kickoff}ms the game is ${data.status}",
                data.status == QuickGameTileStatus.LIVE,
                presents,
            )
            assertEquals(
                "at ${now - kickoff}ms the tile publishes a ${data.status} game",
                data.status == QuickGameTileStatus.LIVE,
                data.hasGame,
            )
        }
    }

    @Test
    fun carriesScoreAndSport() {
        val data = quickGameTileData(state(kickoff), kickoff)
        assertEquals(3, data.scoreOne)
        assertEquals(2, data.scoreTwo)
        assertEquals(QUICK_SPORT_PADEL, data.sport)
    }
}
