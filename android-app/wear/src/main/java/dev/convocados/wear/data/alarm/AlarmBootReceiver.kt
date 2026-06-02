package dev.convocados.wear.data.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import dagger.hilt.android.EntryPointAccessors

/**
 * Reschedules all active game alarms after a device reboot.
 * AlarmManager-scheduled alarms don't survive reboots, so we re-create them
 * from the persisted GameSettings on BOOT_COMPLETED.
 */
class AlarmBootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val pending = goAsync()

        val ep = EntryPointAccessors.fromApplication(context, AlarmBootEntryPoint::class.java)
        val store = ep.settingsStore()
        val scheduler = ep.alarmScheduler()
        val now = System.currentTimeMillis()
        var count = 0

        for ((eventId, settings) in store.allSettings()) {
            val kickoff = settings.effectiveKickoffMs ?: continue
            val enabled = settings.alarms.filter { it.enabled }
            if (enabled.isEmpty()) continue
            val fires = computeAlarmTimes(kickoff, enabled, settings.durationMinutes, now)
            if (fires.isNotEmpty()) {
                scheduler.reschedule(eventId, fires)
                count += fires.size
            }
        }

        Log.d("AlarmBootReceiver", "Rescheduled $count alarms after reboot")
        pending.finish()
    }
}
