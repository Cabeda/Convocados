package dev.convocados.wear.data.alarm

import org.junit.Assert.*
import org.junit.Test

/**
 * Tests the boot-receiver rescheduling logic using the same pure functions
 * it calls (computeAlarmTimes + effectiveKickoffMs). The receiver itself is
 * thin glue over these; this validates the selection/filtering logic.
 */
class AlarmBootReceiverTest {

    private val now = 1_000_000_000_000L

    @Test
    fun `event with effectiveKickoff and active alarms produces fires`() {
        val settings = GameSettings(
            scheduledKickoffMs = now - 5 * 60_000L, // started 5 min ago
            durationMinutes = 60,
            alarms = listOf(GameAlarm("r", AlarmType.RECURRING, minute = 10)),
        )
        val fires = computeAlarmTimes(
            settings.effectiveKickoffMs!!, settings.alarms.filter { it.enabled }, settings.durationMinutes, now,
        )
        // 10, 20, 30… are at kickoff+10m etc; only future ones remain
        assertTrue(fires.isNotEmpty())
        assertTrue(fires.all { it.triggerAtMs > now })
    }

    @Test
    fun `event with null effective kickoff is skipped`() {
        val settings = GameSettings(alarms = listOf(GameAlarm("r", AlarmType.RECURRING, minute = 5)))
        assertNull(settings.effectiveKickoffMs)
    }

    @Test
    fun `event with no enabled alarms produces no fires`() {
        val settings = GameSettings(
            scheduledKickoffMs = now,
            durationMinutes = 60,
            alarms = listOf(GameAlarm("d", AlarmType.RECURRING, minute = 5, enabled = false)),
        )
        val fires = computeAlarmTimes(
            settings.effectiveKickoffMs!!, settings.alarms.filter { it.enabled }, settings.durationMinutes, now,
        )
        assertTrue(fires.isEmpty())
    }

    @Test
    fun `event whose game ended produces no fires`() {
        val settings = GameSettings(
            scheduledKickoffMs = now - 120 * 60_000L, // 2h ago, 60 min game -> ended 1h ago
            durationMinutes = 60,
            alarms = listOf(GameAlarm("r", AlarmType.RECURRING, minute = 5)),
        )
        val fires = computeAlarmTimes(
            settings.effectiveKickoffMs!!, settings.alarms.filter { it.enabled }, settings.durationMinutes, now,
        )
        assertTrue(fires.isEmpty())
    }

    @Test
    fun `kickoff override takes precedence over scheduled`() {
        val settings = GameSettings(
            kickoffEpochMs = now - 2 * 60_000L, // overridden: 2 min ago
            scheduledKickoffMs = now - 60 * 60_000L, // scheduled: 1h ago
            durationMinutes = 60,
            alarms = listOf(GameAlarm("r", AlarmType.RECURRING, minute = 5)),
        )
        assertEquals(now - 2 * 60_000L, settings.effectiveKickoffMs)
        val fires = computeAlarmTimes(
            settings.effectiveKickoffMs!!, settings.alarms.filter { it.enabled }, settings.durationMinutes, now,
        )
        // 5,10,15… min after override kickoff; first future = 3 min from now
        assertTrue(fires.isNotEmpty())
        assertEquals(settings.effectiveKickoffMs!! + 5 * 60_000L, fires[0].triggerAtMs)
    }
}
