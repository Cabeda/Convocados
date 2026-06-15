package dev.convocados.wear.data.alarm

import kotlinx.serialization.Serializable

@Serializable
enum class AlarmType { SINGLE, RECURRING }

/**
 * A game alarm, relative to kickoff.
 * - SINGLE: vibrates once at [minute] minutes after kickoff.
 * - RECURRING: vibrates every [minute] minutes after kickoff (minute = interval).
 *
 * [pulses] (1..3) selects the vibration pattern so different alarms feel distinct.
 */
@Serializable
data class GameAlarm(
    val id: String,
    val type: AlarmType,
    val minute: Int,
    val pulses: Int = 1,
    val enabled: Boolean = true,
)

/** Per-event, device-local game settings (kickoff override + alarms). */
@Serializable
data class GameSettings(
    val kickoffEpochMs: Long? = null,
    val scheduledKickoffMs: Long? = null,
    val durationMinutes: Int = 60,
    val alarms: List<GameAlarm> = emptyList(),
    val keepScreenOn: Boolean = true,
) {
    /** Effective kickoff: user override ?: scheduled game time. */
    val effectiveKickoffMs: Long? get() = kickoffEpochMs ?: scheduledKickoffMs
}

/** A single scheduled vibration. */
data class AlarmFire(val triggerAtMs: Long, val pulses: Int)

/**
 * Expands the enabled alarms into concrete future fire times within the game
 * window (kickoff .. kickoff + [durationMinutes]). Pure and side-effect free:
 * deterministic for a given (kickoff, alarms, duration, now). Only times strictly
 * after [nowMs] and at/below the game end are returned, sorted ascending.
 */
fun computeAlarmTimes(
    kickoffMs: Long,
    alarms: List<GameAlarm>,
    durationMinutes: Int,
    nowMs: Long,
): List<AlarmFire> {
    val endMs = kickoffMs + durationMinutes * 60_000L
    val fires = mutableListOf<AlarmFire>()
    for (alarm in alarms) {
        if (!alarm.enabled || alarm.minute <= 0) continue
        val pulses = alarm.pulses.coerceIn(1, 3)
        when (alarm.type) {
            AlarmType.SINGLE -> {
                val t = kickoffMs + alarm.minute * 60_000L
                if (t in (nowMs + 1)..endMs) fires += AlarmFire(t, pulses)
            }
            AlarmType.RECURRING -> {
                var k = 1
                while (true) {
                    val t = kickoffMs + k.toLong() * alarm.minute * 60_000L
                    if (t > endMs) break
                    if (t > nowMs) fires += AlarmFire(t, pulses)
                    k++
                }
            }
        }
    }
    return fires.sortedBy { it.triggerAtMs }
}
