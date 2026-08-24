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
        val playerName = message.data["player"] // for payment_self_reported actions
        // ADR 0025: invite pushes carry the PlayerInvite token so the
        // Accept/Decline notification actions can answer without opening the app,
        // plus sport/time/place so the decision is informed.
        val inviteToken = message.data["inviteToken"]
        val inviteSport = message.data["sport"]
        val inviteStartsAt = message.data["startsAt"]
        val inviteLocation = message.data["location"]

        val notificationId = System.currentTimeMillis().toInt()
        // Extract eventId from url (format: /events/<id> or /events/<id>?...)
        val eventId = url?.removePrefix("/events/")?.split("?")?.firstOrNull()

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            url?.let { putExtra("deep_link", it) }
        }
        val pendingIntent = PendingIntent.getActivity(
            this, url?.hashCode() ?: notificationId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val channelId = channelIdFor(type)

        val builder = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)

        // ADR 0017: Quick actions per notification type
        if (eventId != null) {
            when (type) {
                // RSVP: Yes / No buttons
                "rsvp_request", "reminder" -> {
                    builder.addAction(0, getString(R.string.action_im_in),
                        createActionIntent(NotificationActionReceiver.ACTION_RSVP_YES, eventId, notificationId))
                    builder.addAction(0, getString(R.string.action_cant_make_it),
                        createActionIntent(NotificationActionReceiver.ACTION_RSVP_NO, eventId, notificationId))
                }
                // Join game: recruitment, spots
                "recruitment", "few_spots_left", "spot_available", "game_invite" -> {
                    builder.addAction(0, getString(R.string.action_join),
                        createActionIntent(NotificationActionReceiver.ACTION_JOIN, eventId, notificationId))
                }
                // ADR 0025: invite push — Accept/Decline in place; tapping the body
                // opens the event page (url is /events/<id>, set server-side).
                // BigText carries "sport · local time · place" under the invite line.
                "player_invited" -> {
                    val detailLine = InviteNotificationFormatter.buildDetailLine(inviteSport, inviteStartsAt, inviteLocation)
                    if (detailLine.isNotEmpty()) {
                        builder.setStyle(NotificationCompat.BigTextStyle().bigText(InviteNotificationFormatter.buildBigText(body, detailLine)))
                    }
                    if (inviteToken != null) {
                        builder.addAction(0, getString(R.string.invite_accept),
                            createActionIntent(NotificationActionReceiver.ACTION_INVITE_ACCEPT, eventId, notificationId, null, inviteToken))
                        builder.addAction(0, getString(R.string.invite_decline),
                            createActionIntent(NotificationActionReceiver.ACTION_INVITE_DECLINE, eventId, notificationId, null, inviteToken))
                    }
                }
                // Payment self-report: organizer quick-confirm
                "payment_self_reported" -> {
                    builder.addAction(0, getString(R.string.action_confirm_payment),
                        createActionIntent(NotificationActionReceiver.ACTION_CONFIRM_PAYMENT, eventId, notificationId, playerName))
                }
                // Post-game: just open (deep link handles it)
                "post_game" -> {
                    builder.addAction(0, getString(R.string.action_add_score), pendingIntent)
                }
            }
        }

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(notificationId, builder.build())
    }

    private fun createActionIntent(
        action: String,
        eventId: String,
        notificationId: Int,
        playerName: String? = null,
        inviteToken: String? = null,
    ): PendingIntent {
        val intent = Intent(this, NotificationActionReceiver::class.java).apply {
            putExtra(NotificationActionReceiver.EXTRA_ACTION, action)
            putExtra(NotificationActionReceiver.EXTRA_EVENT_ID, eventId)
            putExtra(NotificationActionReceiver.EXTRA_NOTIFICATION_ID, notificationId)
            playerName?.let { putExtra(NotificationActionReceiver.EXTRA_PLAYER_NAME, it) }
            inviteToken?.let { putExtra(NotificationActionReceiver.EXTRA_INVITE_TOKEN, it) }
        }
        return PendingIntent.getBroadcast(
            this, "$action:$eventId:${playerName ?: ""}:$inviteToken".hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    companion object {
        const val CHANNEL_GAME_REMINDERS = "game_reminders"
        const val CHANNEL_PLAYER_ACTIVITY = "player_activity"
        const val CHANNEL_POST_GAME = "post_game"
        const val CHANNEL_PAYMENT_REMINDERS = "payment_reminders"
        const val CHANNEL_EVENT_UPDATES = "event_updates"

        /** Notification type → Android channel. Keep in sync with NotificationJobType on the server. */
        fun channelIdFor(type: String?): String = when (type) {
            // Tier 2 — Game-level
            "reminder" -> CHANNEL_GAME_REMINDERS
            "player_joined", "player_left", "player_joined_bench",
            "player_left_bench", "player_left_promoted",
            "game_full", "spot_available", "bench_promoted_capacity",
            "rsvp_request" -> CHANNEL_PLAYER_ACTIVITY
            "post_game" -> CHANNEL_POST_GAME
            "payment_confirmed" -> CHANNEL_PAYMENT_REMINDERS
            "payment_self_reported" -> CHANNEL_PAYMENT_REMINDERS
            // Tier 1 — Event-level
            "game_cancelled" -> CHANNEL_EVENT_UPDATES
            "game_invite" -> CHANNEL_EVENT_UPDATES
            "player_invited" -> CHANNEL_EVENT_UPDATES
            "event_details" -> CHANNEL_EVENT_UPDATES
            "recruitment", "few_spots_left" -> CHANNEL_EVENT_UPDATES
            // Legacy / fallback
            "game_reminder" -> CHANNEL_GAME_REMINDERS
            "player_activity" -> CHANNEL_PLAYER_ACTIVITY
            "payment_reminder" -> CHANNEL_PAYMENT_REMINDERS
            else -> CHANNEL_PLAYER_ACTIVITY
        }

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
                NotificationChannel(CHANNEL_EVENT_UPDATES, "Event Updates", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Cancellations, invites, recruitment, and event changes"
                },
            ))
        }
    }
}
