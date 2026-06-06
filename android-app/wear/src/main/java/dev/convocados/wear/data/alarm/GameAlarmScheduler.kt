package dev.convocados.wear.data.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

import android.os.Build

/**
 * Schedules per-event game alarms as exact [AlarmManager] alarms that fire even
 * in Doze. Falls back to inexact ([AlarmManager.setAndAllowWhileIdle]) when the
 * exact-alarm permission is unavailable. Alarms survive the app being killed
 * (they're cancelled explicitly when the user leaves the game).
 */
@Singleton
class GameAlarmScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    fun canScheduleExact(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            alarmManager.canScheduleExactAlarms()
        } else {
            true
        }

    /** Cancel any previously-scheduled alarms for the event and schedule [fires]. */
    fun reschedule(eventId: String, fires: List<AlarmFire>) {
        cancelAll(eventId)
        val base = baseCode(eventId)
        fires.take(MAX_ALARMS).forEachIndexed { i, fire ->
            val pi = pendingIntent(eventId, base + i, fire.pulses, create = true) ?: return@forEachIndexed
            try {
                if (canScheduleExact()) {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fire.triggerAtMs, pi)
                } else {
                    alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fire.triggerAtMs, pi)
                }
            } catch (_: SecurityException) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fire.triggerAtMs, pi)
            }
        }
    }

    fun cancelAll(eventId: String) {
        val base = baseCode(eventId)
        for (i in 0 until MAX_ALARMS) {
            pendingIntent(eventId, base + i, 0, create = false)?.let {
                alarmManager.cancel(it)
                it.cancel()
            }
        }
    }

    private fun pendingIntent(eventId: String, code: Int, pulses: Int, create: Boolean): PendingIntent? {
        val intent = Intent(context, GameAlarmReceiver::class.java).apply {
            action = GameAlarmReceiver.ACTION
            data = Uri.parse("alarm://$eventId/$code")
            putExtra(GameAlarmReceiver.EXTRA_PULSES, pulses)
        }
        val flags = (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE) or
            PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, code, intent, flags)
    }

    /** Deterministic, collision-spaced request-code base per event. */
    private fun baseCode(eventId: String): Int = (eventId.hashCode() and 0x1FFFF) * MAX_ALARMS

    companion object {
        const val MAX_ALARMS = 64
    }
}
