package dev.convocados.wear.ui.ongoing

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.wear.ongoing.OngoingActivity
import dev.convocados.wear.R
import dev.convocados.wear.ui.WearActivity
import dev.convocados.wear.util.GameScorePhase

/** One-line summary shown on the watch face and in the ongoing notification. */
internal fun ongoingScoreText(teamOne: String, scoreOne: Int, teamTwo: String, scoreTwo: Int): String =
    "$teamOne $scoreOne – $scoreTwo $teamTwo"

/** A live server-backed game is ongoing once scoring has started and before it ends. */
internal fun shouldShowLiveGameOngoing(isScoring: Boolean, phase: GameScorePhase): Boolean =
    isScoring && phase != GameScorePhase.ENDED

/** A quick game is ongoing from its kickoff until its duration elapses. */
internal fun shouldShowQuickGameOngoing(kickoffMs: Long?, durationMinutes: Int, nowMs: Long): Boolean {
    if (kickoffMs == null) return false
    val elapsed = nowMs - kickoffMs
    return elapsed >= 0 && elapsed < durationMinutes * 60_000L
}

/**
 * Posts (and clears) the Wear OS Ongoing Activity that backs the live score.
 *
 * Play's "Wear App Quality Guidelines: Missing ongoing activity" policy requires
 * an ongoing score session to surface itself on the watch face and recent-apps
 * chip. Pairing an ongoing notification with an [OngoingActivity] is what makes
 * the device render those indicators; the app has no tile, so the "reference the
 * activity from the tile" clause does not apply.
 */
object WearOngoingActivity {
    const val NOTIFICATION_ID = 7447
    const val CHANNEL_ID = "ongoing_game"

    fun show(context: Context, title: String, text: String) {
        ensureChannel(context)
        val touchIntent = touchIntent(context)
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_ongoing_game)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(touchIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)

        OngoingActivity.Builder(context, NOTIFICATION_ID, builder)
            .setStaticIcon(R.drawable.ic_ongoing_game)
            .setTouchIntent(touchIntent)
            .build()
            .apply(context)
    }

    fun stop(context: Context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    private fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.ongoing_channel_name),
                NotificationManager.IMPORTANCE_LOW,
            ).apply { setShowBadge(false) },
        )
    }

    private fun touchIntent(context: Context): PendingIntent {
        val intent = Intent(context, WearActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}

/**
 * Keeps an Ongoing Activity in sync with the current score while [enabled], and
 * clears it when the session ends or the screen leaves composition.
 */
@Composable
fun RememberOngoingActivity(enabled: Boolean, title: String, text: String) {
    val context = LocalContext.current
    LaunchedEffect(enabled, title, text) {
        if (enabled) WearOngoingActivity.show(context, title, text)
    }
    DisposableEffect(enabled) {
        if (!enabled) WearOngoingActivity.stop(context)
        onDispose { WearOngoingActivity.stop(context) }
    }
}
