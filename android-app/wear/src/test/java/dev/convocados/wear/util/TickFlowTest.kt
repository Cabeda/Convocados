package dev.convocados.wear.util

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.temporal.ChronoUnit

@OptIn(ExperimentalCoroutinesApi::class)
class TickFlowTest {

    @Test
    fun `tickFlow emits initial value immediately`() = runTest {
        val instant = tickFlow(intervalMs = 1000L).first()
        assertNotNull(instant)
    }

    @Test
    fun `canScoreGame returns true for game within 1 hour`() {
        val nearInstant = Instant.now().plus(30, ChronoUnit.MINUTES)
        assertTrue(canScoreGame(nearInstant.toString()))
    }

    @Test
    fun `canScoreGame returns false for game more than 1 hour away`() {
        val futureInstant = Instant.now().plus(2, ChronoUnit.HOURS)
        assertFalse(canScoreGame(futureInstant.toString()))
    }

    @Test
    fun `canScoreGame returns true for game already started`() {
        val pastInstant = Instant.now().minus(5, ChronoUnit.MINUTES)
        assertTrue(canScoreGame(pastInstant.toString()))
    }

    @Test
    fun `canScoreGame returns false for game well over 1 hour away`() {
        val futureInstant = Instant.now().plus(2, ChronoUnit.HOURS)
        assertFalse(canScoreGame(futureInstant.toString()))
    }
}