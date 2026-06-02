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

        val ep = EntryPointAccessors.fromApplication(context, AlarmBootEntryPoint::class.java)
        val store = ep.settingsStore()
        val scheduler = ep.alarmScheduler()
        val now = System.currentTimeMillis()
        var count = 0

        for ((eventId, settings) in store.allSettings()) {
            val kickoff = settings.kickoffEpochMs ?: continue
            val enabled = settings.alarms.filter { it.enabled }
            if (enabled.isEmpty()) continue
            // Use a generous duration (max sport = 90 min) to not miss late alarms.
            val fires = computeAlarmTimes(kickoff, enabled, MAX_DURATION_MINUTES, now)
            if (fires.isNotEmpty()) {
                scheduler.reschedule(eventId, fires)
                count += fires.size
            }
        }

        Log.d("AlarmBootReceiver", "Rescheduled $count alarms after reboot")
    }

    companion object {
        private const val MAX_DURATION_MINUTES = 120
    }
}
