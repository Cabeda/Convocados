package dev.convocados.data.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import dev.convocados.MainActivity
import dev.convocados.R
import javax.inject.Inject

@AndroidEntryPoint
class ConvocadosFcmService : FirebaseMessagingService() {

    @Inject lateinit var pushTokenManager: PushTokenManager

    override fun onNewToken(token: String) {
        Log.d("FCM", "New token: ${token.take(20)}...")
        // Re-register immediately if user is authenticated
        pushTokenManager.onNewToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        Log.d("FCM", "Message received: ${message.data}")
        val title = message.notification?.title ?: message.data["title"] ?: "Convocados"
        val body = message.notification?.body ?: message.data["body"] ?: return
        val url = message.data["url"]
        val type = message.data["type"]

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            url?.let { putExtra("deep_link", it) }
        }
        val pendingIntent = PendingIntent.getActivity(
            this, url?.hashCode() ?: System.currentTimeMillis().toInt(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val channelId = when (type) {
            "game_reminder" -> CHANNEL_GAME_REMINDERS
            "player_activity" -> CHANNEL_PLAYER_ACTIVITY
            "post_game" -> CHANNEL_POST_GAME
            "payment_reminder" -> CHANNEL_PAYMENT_REMINDERS
            else -> CHANNEL_PLAYER_ACTIVITY
        }

        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(System.currentTimeMillis().toInt(), notification)
    }

    companion object {
        const val CHANNEL_GAME_REMINDERS = "game_reminders"
        const val CHANNEL_PLAYER_ACTIVITY = "player_activity"
        const val CHANNEL_POST_GAME = "post_game"
        const val CHANNEL_PAYMENT_REMINDERS = "payment_reminders"

        fun createChannels(context: Context) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannels(listOf(
                NotificationChannel(CHANNEL_GAME_REMINDERS, "Game Reminders", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Upcoming game reminders"
                },
                NotificationChannel(CHANNEL_PLAYER_ACTIVITY, "Player Activity", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Player joins, leaves, and updates"
                },
                NotificationChannel(CHANNEL_POST_GAME, "Post Game", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Scores and post-game summaries"
                },
                NotificationChannel(CHANNEL_PAYMENT_REMINDERS, "Payment Reminders", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Payment and fee reminders"
                },
            ))
        }
    }
}
