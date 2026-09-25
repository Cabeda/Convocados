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
import androidx.wear.ongoing.Status
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
 * Where the ongoing activity's chip and the quick-game tile should return the
 * user. Without this, both opened [WearActivity] at the games list instead of
 * the live session, which is the "reopened and it didn't open in the game"
 * complaint (and part of Play's ongoing-activity gate).
 */
data class OngoingLaunch(
    val eventId: String? = null,
    val quickGame: Boolean = false,
)

/**
 * Reads the deep-link target from an activity launch [Intent]. Returns null for
 * a plain launcher open (no target).
 */
fun parseOngoingLaunch(intent: Intent?): OngoingLaunch? {
    intent ?: return null
    val eventId = intent.getStringExtra(WearOngoingActivity.EXTRA_EVENT_ID)
    val quickGame = intent.getBooleanExtra(WearOngoingActivity.EXTRA_QUICK_GAME, false)
    return when {
        !eventId.isNullOrBlank() -> OngoingLaunch(eventId = eventId)
        quickGame -> OngoingLaunch(quickGame = true)
        else -> null
    }
}

/** The launch intent for the ongoing activity's touch target, carrying the deep link. */
internal fun ongoingLaunchIntent(context: Context, launch: OngoingLaunch): Intent =
    Intent(context, WearActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        launch.eventId?.let { putExtra(WearOngoingActivity.EXTRA_EVENT_ID, it) }
        if (launch.quickGame) putExtra(WearOngoingActivity.EXTRA_QUICK_GAME, true)
    }

/**
 * The Ongoing Activity status rendered on the watch-face chip and recents
 * surface. For a live score, the text *is* the score, so a glance is enough
 * instead of reopening the app.
 */
internal fun ongoingStatus(text: String): Status = Status.forPart(Status.TextPart(text))

/**
 * Whether leaving composition should clear the ongoing activity. Only a session
 * that is no longer live may clear it: navigating to Teams/Save mid-game must
 * not drop the indicator Play and the user expect to persist.
 */
internal fun shouldClearOngoing(enabled: Boolean): Boolean = !enabled

/**
 * Posts (and clears) the Wear OS Ongoing Activity that backs the live score.
 *
 * Play's "Wear App Quality Guidelines: Missing ongoing activity" policy requires
 * an ongoing score session to surface itself on the watch face and recent-apps
 * chip. Pairing an ongoing notification with an [OngoingActivity] is what makes
 * the device render those indicators, and [OngoingLaunch] ensures tapping the
 * chip resumes the live session rather than the games list.
 */
object WearOngoingActivity {
    const val NOTIFICATION_ID = 7447
    const val CHANNEL_ID = "ongoing_game"
    const val EXTRA_EVENT_ID = "dev.convocados.wear.EXTRA_ONGOING_EVENT_ID"
    const val EXTRA_QUICK_GAME = "dev.convocados.wear.EXTRA_ONGOING_QUICK_GAME"

    fun show(
        context: Context,
        title: String,
        text: String,
        launch: OngoingLaunch = OngoingLaunch(),
    ) {
        ensureChannel(context)
        val touchIntent = touchIntent(context, launch)
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_ongoing_game)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(touchIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)

        // OngoingActivity.apply() only attaches the ongoing-activity metadata to
        // the notification builder; it does NOT post the notification. Without
        // an explicit notify() the watch face indicator and recents chip never
        // render, which is what Play's "Missing ongoing activity" gate flags.
        OngoingActivity.Builder(context, NOTIFICATION_ID, builder)
            .setStaticIcon(R.drawable.ic_ongoing_game)
            .setTouchIntent(touchIntent)
            .setStatus(ongoingStatus(text))
            .setContentDescription(text)
            .build()
            .apply(context)

        val notificationManager = NotificationManagerCompat.from(context)
        if (notificationManager.areNotificationsEnabled()) {
            notificationManager.notify(NOTIFICATION_ID, builder.build())
        }
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

    private fun touchIntent(context: Context, launch: OngoingLaunch): PendingIntent =
        PendingIntent.getActivity(
            context,
            0,
            ongoingLaunchIntent(context, launch),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
}

/**
 * Keeps an Ongoing Activity in sync with the current score while [enabled], and
 * clears it only when the session stops. Leaving the screen while the game is
 * still live deliberately leaves the indicator in place.
 */
@Composable
fun RememberOngoingActivity(
    enabled: Boolean,
    title: String,
    text: String,
    launch: OngoingLaunch,
) {
    val context = LocalContext.current
    LaunchedEffect(enabled, title, text, launch) {
        if (enabled) WearOngoingActivity.show(context, title, text, launch)
    }
    DisposableEffect(enabled) {
        if (shouldClearOngoing(enabled)) WearOngoingActivity.stop(context)
        onDispose { if (shouldClearOngoing(enabled)) WearOngoingActivity.stop(context) }
    }
}
