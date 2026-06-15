package dev.convocados.wear.data.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** Vibrates the watch when a scheduled game alarm fires. Pulse count distinguishes alarms. */
class GameAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        vibrator(context).vibrate(VibrationEffect.createWaveform(PATTERN, AMPLITUDES, -1))
    }

    private fun vibrator(context: Context): Vibrator =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as android.os.VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }

    companion object {
        const val ACTION = "dev.convocados.wear.GAME_ALARM"
        const val EXTRA_PULSES = "pulses"

        // Distinctive "da-da-DA — da-da-DA" pattern: 3 escalating bursts, pause, repeat.
        // Hard to confuse with any system notification.
        private val PATTERN = longArrayOf(
            0,    // start immediately
            120,  // buzz 1
            80,   // pause
            120,  // buzz 2
            80,   // pause
            300,  // buzz 3 (long, strong)
            400,  // gap between groups
            120,  // buzz 4
            80,   // pause
            120,  // buzz 5
            80,   // pause
            300,  // buzz 6 (long, strong)
        )
        private val AMPLITUDES = intArrayOf(
            0,    // start
            180,  // buzz 1 medium
            0,    // pause
            200,  // buzz 2 medium-high
            0,    // pause
            255,  // buzz 3 MAX
            0,    // gap
            180,  // buzz 4 medium
            0,    // pause
            200,  // buzz 5 medium-high
            0,    // pause
            255,  // buzz 6 MAX
        )
    }
}
