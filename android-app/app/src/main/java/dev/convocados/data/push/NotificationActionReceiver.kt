package dev.convocados.data.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.app.NotificationManager
import android.util.Log
import dagger.hilt.android.AndroidEntryPoint
import dev.convocados.data.api.ConvocadosApi
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

    @Inject lateinit var api: ConvocadosApi

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.getStringExtra(EXTRA_ACTION) ?: return
        val eventId = intent.getStringExtra(EXTRA_EVENT_ID) ?: return
        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, -1)
        val playerName = intent.getStringExtra(EXTRA_PLAYER_NAME)

        Log.d("NotificationAction", "Action=$action eventId=$eventId")

        // Dismiss the notification immediately
        if (notificationId != -1) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(notificationId)
        }

        // Fire-and-forget API call
        CoroutineScope(Dispatchers.IO).launch {
            try {
                when (action) {
                    ACTION_RSVP_YES -> api.submitRsvp(eventId, "yes")
                    ACTION_RSVP_NO -> api.submitRsvp(eventId, "no")
                    ACTION_JOIN -> api.quickJoin(eventId)
                    ACTION_CONFIRM_PAYMENT -> if (playerName != null) {
                        api.updatePaymentStatus(eventId, playerName, "paid")
                    }
                }
            } catch (e: Exception) {
                Log.e("NotificationAction", "Failed: $action for $eventId", e)
            }
        }
    }

    companion object {
        const val EXTRA_ACTION = "notification_action"
        const val EXTRA_EVENT_ID = "event_id"
        const val EXTRA_NOTIFICATION_ID = "notification_id"
        const val EXTRA_PLAYER_NAME = "player_name"

        const val ACTION_RSVP_YES = "rsvp_yes"
        const val ACTION_RSVP_NO = "rsvp_no"
        const val ACTION_JOIN = "join"
        const val ACTION_CONFIRM_PAYMENT = "confirm_payment"
    }
}
