package dev.convocados.wear.util

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.temporal.ChronoUnit

class GameScorePhaseTest {

    private val now: Instant = Instant.parse("2026-08-27T10:00:00Z")

    private fun mins(m: Long): Instant = now.plus(m, ChronoUnit.MINUTES)
    private fun iso(t: Instant): String = t.toString()

    @Test
    fun `far-future game is NOT_STARTED`() {
        // 2h away — more than the 1h pre-start window
        assertEquals(GameScorePhase.NOT_STARTED, gameScorePhase(iso(mins(120)), now))
    }

    @Test
    fun `kickoff override is used instead of scheduled start`() {
        assertEquals(
            GameScorePhase.SCORABLE,
            gameScorePhase(
                dateTime = iso(mins(120)),
                now = now,
                kickoffEpochMs = now.toEpochMilli(),
            ),
        )
    }

    @Test
    fun `game within 1h before start is SCORABLE`() {
        assertEquals(GameScorePhase.SCORABLE, gameScorePhase(iso(mins(30)), now))
    }

    @Test
    fun `game right now is SCORABLE`() {
        assertEquals(GameScorePhase.SCORABLE, gameScorePhase(iso(mins(0)), now))
    }

    @Test
    fun `game in progress is SCORABLE`() {
        assertEquals(GameScorePhase.SCORABLE, gameScorePhase(iso(mins(-30)), now))
    }

    @Test
    fun `game past its window is still SCORABLE`() {
        // #1360: the clock never ends a game. The organizer closes it with the
        // Finish action, so a match that runs over can still be scored.
        assertEquals(GameScorePhase.SCORABLE, gameScorePhase(iso(mins(-61)), now))
        assertEquals(GameScorePhase.SCORABLE, gameScorePhase(iso(mins(-300)), now))
    }

    @Test
    fun `missing or unparseable dateTime is SCORABLE`() {
        assertEquals(GameScorePhase.SCORABLE, gameScorePhase(null, now))
        assertEquals(GameScorePhase.SCORABLE, gameScorePhase("not-a-date", now))
    }
}
