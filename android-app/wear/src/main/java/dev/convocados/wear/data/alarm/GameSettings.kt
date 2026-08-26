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
    val vibrationEnabled: Boolean = false,
    val vibrationIntervalMinutes: Int = 5,
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

/**
 * Projects every enabled alarm onto the game window as an edge fraction in
 * 0..1 (for the score ring ticks). Unlike [computeAlarmTimes] this includes
 * times already passed, so past ticks can be dimmed and the next emphasised —
 * and it never emits beyond the game end. Pure and side-effect free.
 */
fun computeAlarmFractions(
    alarms: List<GameAlarm>,
    durationMinutes: Int,
): List<Float> = buildList {
    val totalMs = durationMinutes * 60_000L
    for (alarm in alarms) {
        if (!alarm.enabled || alarm.minute <= 0) continue
        when (alarm.type) {
            AlarmType.SINGLE -> {
                val t = alarm.minute * 60_000L
                if (t <= totalMs) add(t.toFloat() / totalMs)
            }
            AlarmType.RECURRING -> {
                var i = 1
                while (true) {
                    val t = i * alarm.minute * 60_000L
                    if (t > totalMs) break
                    add(t.toFloat() / totalMs)
                    i++
                }
            }
        }
    }
}.sorted()
