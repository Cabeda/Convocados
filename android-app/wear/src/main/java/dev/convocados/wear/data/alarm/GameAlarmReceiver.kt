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
        val pulses = intent.getIntExtra(EXTRA_PULSES, 1).coerceIn(1, 3)
        vibrator(context).vibrate(VibrationEffect.createWaveform(patternFor(pulses), -1))
    }

    private fun vibrator(context: Context): Vibrator =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as android.os.VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }

    private fun patternFor(pulses: Int): LongArray = when (pulses) {
        2 -> longArrayOf(0, 250, 180, 250)
        3 -> longArrayOf(0, 200, 150, 200, 150, 200)
        else -> longArrayOf(0, 450)
    }

    companion object {
        const val ACTION = "dev.convocados.wear.GAME_ALARM"
        const val EXTRA_PULSES = "pulses"
    }
}
