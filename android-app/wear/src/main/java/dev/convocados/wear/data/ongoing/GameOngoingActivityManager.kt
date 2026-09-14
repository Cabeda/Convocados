package dev.convocados.wear.data.ongoing

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import dev.convocados.wear.R
import dev.convocados.wear.ui.WearActivity

/**
 * Posts / clears the Wear Ongoing Activity for live scoring (Play quality
 * gate). Shows the watch-face indicator + Recents chip and lets the user tap
 * back into the game. No tile is shipped, so no tile reference applies.
 */
object GameOngoingActivityManager {

    fun startLive(context: Context, gameTitle: String?, scoreOne: Int, scoreTwo: Int) {
        val title = gameTitle?.ifBlank { null }?.let {
            context.getString(R.string.ongoing_live_title, it)
        } ?: context.getString(R.string.ongoing_quick_title)
        post(
            context,
            OngoingGameStatus.LIVE_ONGOING_ID,
            title,
            context.getString(
                R.string.ongoing_live_text,
                scoreOne,
                scoreTwo,
            ),
        )
    }

    fun stopLive(context: Context) = cancel(context, OngoingGameStatus.LIVE_ONGOING_ID)

    fun startQuick(context: Context, scoreOne: Int, scoreTwo: Int) {
        post(
            context,
            OngoingGameStatus.QUICK_ONGOING_ID,
            context.getString(R.string.ongoing_quick_title),
            context.getString(R.string.ongoing_quick_text, scoreOne, scoreTwo),
        )
    }

    fun stopQuick(context: Context) = cancel(context, OngoingGameStatus.QUICK_ONGOING_ID)

    private fun post(context: Context, id: Int, title: String, text: String) {
        if (!canPost(context)) return
        ensureChannel(context)
        val touchIntent = launchIntent(context, id)
        val builder = NotificationCompat.Builder(context, OngoingGameStatus.CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(touchIntent)
        val status = Status.Builder().addTemplate(text).build()
        val ongoing = OngoingActivity.Builder(context, id, builder)
            .setStaticIcon(R.mipmap.ic_launcher)
            .setTouchIntent(touchIntent)
            .setStatus(status)
            .build()
        runCatching {
            ongoing.apply(context)
            notificationManager(context).notify(id, builder.build())
        }
    }

    private fun cancel(context: Context, id: Int) {
        runCatching { notificationManager(context).cancel(id) }
    }

    private fun canPost(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = notificationManager(context)
        if (manager.getNotificationChannel(OngoingGameStatus.CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                OngoingGameStatus.CHANNEL_ID,
                context.getString(R.string.ongoing_channel_name),
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = context.getString(R.string.ongoing_channel_desc) },
        )
    }

    private fun launchIntent(context: Context, requestCode: Int): PendingIntent {
        val intent = Intent(context, WearActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun notificationManager(context: Context): NotificationManager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
}
