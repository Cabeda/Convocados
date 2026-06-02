package dev.convocados.wear.data.alarm

import org.junit.Assert.assertEquals
import org.junit.Test

class GameAlarmScheduleTest {

    private val kickoff = 1_000_000_000_000L // arbitrary epoch ms
    private fun min(m: Int) = m * 60_000L

    @Test
    fun `single alarm fires once at its minute`() {
        val alarms = listOf(GameAlarm("a", AlarmType.SINGLE, minute = 25, pulses = 2))
        val fires = computeAlarmTimes(kickoff, alarms, durationMinutes = 60, nowMs = kickoff)
        assertEquals(1, fires.size)
        assertEquals(kickoff + min(25), fires[0].triggerAtMs)
        assertEquals(2, fires[0].pulses)
    }

    @Test
    fun `recurring alarm fires every interval until game end`() {
        val alarms = listOf(GameAlarm("a", AlarmType.RECURRING, minute = 5, pulses = 1))
        val fires = computeAlarmTimes(kickoff, alarms, durationMinutes = 20, nowMs = kickoff)
        // 5,10,15,20 (20 == end is inclusive); 25 is past end
        assertEquals(listOf(min(5), min(10), min(15), min(20)).map { kickoff + it }, fires.map { it.triggerAtMs })
    }

    @Test
    fun `past fire times are skipped`() {
        val alarms = listOf(GameAlarm("a", AlarmType.RECURRING, minute = 5))
        // now is 12 minutes in: 5 and 10 already passed, 15 and 20 remain
        val fires = computeAlarmTimes(kickoff, alarms, 20, nowMs = kickoff + min(12))
        assertEquals(listOf(kickoff + min(15), kickoff + min(20)), fires.map { it.triggerAtMs })
    }

    @Test
    fun `disabled alarms and non-positive minutes are ignored`() {
        val alarms = listOf(
            GameAlarm("a", AlarmType.SINGLE, minute = 10, enabled = false),
            GameAlarm("b", AlarmType.RECURRING, minute = 0),
        )
        assertEquals(emptyList<AlarmFire>(), computeAlarmTimes(kickoff, alarms, 60, kickoff))
    }

    @Test
    fun `single alarm past game end does not fire`() {
        val alarms = listOf(GameAlarm("a", AlarmType.SINGLE, minute = 90))
        assertEquals(emptyList<AlarmFire>(), computeAlarmTimes(kickoff, alarms, 60, kickoff))
    }

    @Test
    fun `multiple alarms are merged and sorted`() {
        val alarms = listOf(
            GameAlarm("switch", AlarmType.SINGLE, minute = 25, pulses = 3),
            GameAlarm("rotate", AlarmType.RECURRING, minute = 10, pulses = 1),
        )
        val fires = computeAlarmTimes(kickoff, alarms, 50, kickoff)
        assertEquals(
            listOf(min(10), min(20), min(25), min(30), min(40), min(50)).map { kickoff + it },
            fires.map { it.triggerAtMs },
        )
    }
}
