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
     *
     * `gameId` scopes payment actions to a single occurrence game (#1236).
     */
    suspend fun handle(action: String, eventId: String, playerName: String?, inviteToken: String? = null, gameId: String? = null) {
        try {
            when (action) {
                ACTION_RSVP_YES -> api.submitRsvp(eventId, "yes")
                // Decline = leave: removes the player from the list (and sets RSVP "no").
                ACTION_RSVP_NO -> api.leaveEvent(eventId)
                ACTION_JOIN -> api.quickJoin(eventId)
                ACTION_CONFIRM_PAYMENT -> if (playerName != null) {
                    api.updatePaymentStatus(eventId, playerName, "paid")
                }
                // #1236: payer answers the 24h check-in straight from the push.
                ACTION_PAYER_MARK_ALL_PAID -> if (gameId != null) {
                    api.payerMarkAllPaid(eventId, gameId)
                }
                ACTION_PAYER_ASK_AGAIN -> if (gameId != null) {
                    api.payerSnoozeCheckIn(eventId, gameId)
                }
                // ADR 0025: quick accept/decline straight from the invite push.
                ACTION_INVITE_ACCEPT -> if (inviteToken != null) {
                    api.respondToInvite(inviteToken, "accept")
                }
                ACTION_INVITE_DECLINE -> if (inviteToken != null) {
                    api.respondToInvite(inviteToken, "decline")
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
        const val ACTION_INVITE_ACCEPT = "invite_accept"
        const val ACTION_INVITE_DECLINE = "invite_decline"
        const val ACTION_PAYER_MARK_ALL_PAID = "payer_mark_all_paid"
        const val ACTION_PAYER_ASK_AGAIN = "payer_ask_again"
    }
}
