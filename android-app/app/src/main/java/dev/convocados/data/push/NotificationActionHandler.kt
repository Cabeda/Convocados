package dev.convocados.data.push

import dev.convocados.data.api.ConvocadosApi
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Maps notification quick-action ids to API calls.
 *
 * Extracted from [NotificationActionReceiver] so the mapping is unit-testable
 * without Robolectric/Hilt. The receiver stays a thin Android wrapper.
 */
@Singleton
class NotificationActionHandler @Inject constructor(private val api: ConvocadosApi) {

    /**
     * Performs the action. Never throws: a failure inside a BroadcastReceiver
     * would crash the app process, and there is no UI to surface errors to.
     */
    suspend fun handle(action: String, eventId: String, playerName: String?) {
        try {
            when (action) {
                ACTION_RSVP_YES -> api.submitRsvp(eventId, "yes")
                // Decline = leave: removes the player from the list (and sets RSVP "no").
                ACTION_RSVP_NO -> api.leaveEvent(eventId)
                ACTION_JOIN -> api.quickJoin(eventId)
                ACTION_CONFIRM_PAYMENT -> if (playerName != null) {
                    api.updatePaymentStatus(eventId, playerName, "paid")
                }
            }
        } catch (_: Exception) {
            // Swallow — see KDoc.
        }
    }

    companion object {
        const val ACTION_RSVP_YES = "rsvp_yes"
        const val ACTION_RSVP_NO = "rsvp_no"
        const val ACTION_JOIN = "join"
        const val ACTION_CONFIRM_PAYMENT = "confirm_payment"
    }
}
