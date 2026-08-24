package dev.convocados.data.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.app.NotificationManager
import android.util.Log
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Handles notification quick-action button taps (RSVP yes/no, join game).
 * Performs the API call in background and dismisses the notification.
 */
@AndroidEntryPoint
class NotificationActionReceiver : BroadcastReceiver() {

    @Inject lateinit var handler: NotificationActionHandler

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.getStringExtra(EXTRA_ACTION) ?: return
        val eventId = intent.getStringExtra(EXTRA_EVENT_ID) ?: return
        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, -1)
        val playerName = intent.getStringExtra(EXTRA_PLAYER_NAME)
        val inviteToken = intent.getStringExtra(EXTRA_INVITE_TOKEN)

        Log.d("NotificationAction", "Action=$action eventId=$eventId")

        // Dismiss the notification immediately
        if (notificationId != -1) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(notificationId)
        }

        // Fire-and-forget API call
        CoroutineScope(Dispatchers.IO).launch {
            handler.handle(action, eventId, playerName, inviteToken)
        }
    }

    companion object {
        const val EXTRA_ACTION = "notification_action"
        const val EXTRA_EVENT_ID = "event_id"
        const val EXTRA_NOTIFICATION_ID = "notification_id"
        const val EXTRA_PLAYER_NAME = "player_name"
        const val EXTRA_INVITE_TOKEN = "invite_token"

        const val ACTION_RSVP_YES = NotificationActionHandler.ACTION_RSVP_YES
        const val ACTION_RSVP_NO = NotificationActionHandler.ACTION_RSVP_NO
        const val ACTION_JOIN = NotificationActionHandler.ACTION_JOIN
        const val ACTION_CONFIRM_PAYMENT = NotificationActionHandler.ACTION_CONFIRM_PAYMENT
        const val ACTION_INVITE_ACCEPT = NotificationActionHandler.ACTION_INVITE_ACCEPT
        const val ACTION_INVITE_DECLINE = NotificationActionHandler.ACTION_INVITE_DECLINE
    }
}
