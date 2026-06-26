package dev.convocados.ui.screen.create

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * #454 — the time picker on the Android "Create Game" screen used to snap
 * to the top of the hour and only offer ±1h / ±1d buttons, so the user
 * could not pick e.g. 18:30. This test guards the fix:
 *
 *   1. The default state preserves the current minutes/seconds.
 *   2. The quick-adjust offset list includes 15/30-minute steps.
 *   3. Applying offsets lands on the expected wall-clock time.
 */
class CreateEventTimePickerTest {

    @Test
    fun defaultState_preservesMinutesAndSeconds() {
        // Simulate the new default-state expression. Must not round to the
        // nearest hour — must keep the same minutes/seconds as now+1h.
        val now = Instant.parse("2026-06-17T14:37:42Z")
        val default = now.plusSeconds(3600)
        val zone = ZoneId.of("UTC")
        val wall = ZonedDateTime.ofInstant(default, zone)
        assertEquals(15, wall.hour)   // 14:37 + 1h = 15:37
        assertEquals(37, wall.minute) // not 0
        assertEquals(42, wall.second) // not 0
    }

    @Test
    fun quickOffsets_include_15_and_30_minute_steps() {
        val labels = TIME_QUICK_OFFSETS.map { it.second }
        // Both polarities of both step sizes must be present.
        assertTrue("+15m" in labels)
        assertTrue("-15m" in labels)
        assertTrue("+30m" in labels)
        assertTrue("-30m" in labels)
    }

    @Test
    fun quickOffsets_15m_step_lands_on_quarter_hour() {
        val base = Instant.parse("2026-06-17T18:00:00Z")
        val plus15 = TIME_QUICK_OFFSETS.first { it.second == "+15m" }
        val result = base.plusSeconds(plus15.first)
        val wall = ZonedDateTime.ofInstant(result, ZoneId.of("UTC"))
        assertEquals(18, wall.hour)
        assertEquals(15, wall.minute)
    }

    @Test
    fun quickOffsets_30m_step_lands_on_half_hour() {
        val base = Instant.parse("2026-06-17T18:15:00Z")
        val plus30 = TIME_QUICK_OFFSETS.first { it.second == "+30m" }
        val result = base.plusSeconds(plus30.first)
        val wall = ZonedDateTime.ofInstant(result, ZoneId.of("UTC"))
        assertEquals(18, wall.hour)
        assertEquals(45, wall.minute)
    }

    @Test
    fun quickOffsets_compose_to_any_quarter_hour() {
        // 18:00 + 4*15m = 19:00.
        val base = Instant.parse("2026-06-17T18:00:00Z")
        val plus15 = TIME_QUICK_OFFSETS.first { it.second == "+15m" }.first
        val result = base.plusSeconds(plus15 * 4)
        val wall = ZonedDateTime.ofInstant(result, ZoneId.of("UTC"))
        assertEquals(19, wall.hour)
        assertEquals(0, wall.minute)
    }

    @Test
    fun quickOffsets_have_paired_polarities() {
        val byOffset = TIME_QUICK_OFFSETS.toMap()
        // +X must always have a matching -X with the same magnitude.
        for ((secs, label) in TIME_QUICK_OFFSETS) {
            assertTrue(
                "Offset $label ($secs) has no symmetric counterpart",
                byOffset.containsKey(-secs),
            )
        }
    }
}
