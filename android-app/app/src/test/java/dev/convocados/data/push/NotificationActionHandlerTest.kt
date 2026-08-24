package dev.convocados.data.push

import dev.convocados.data.api.ConvocadosApi
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Test

/**
 * Unit tests for the notification quick-action → API mapping.
 *
 * Decline semantics: tapping "Can't make it" on a reminder must remove the
 * player from the event list (POST /api/events/[id]/leave), not just record
 * an RSVP of "no" while leaving them on the list.
 */
class NotificationActionHandlerTest {

    private val api = mockk<ConvocadosApi>(relaxed = true)
    private val handler = NotificationActionHandler(api)

    @Test
    fun `rsvp yes confirms attendance`() = runTest {
        handler.handle(NotificationActionHandler.ACTION_RSVP_YES, "evt-1", null)

        coVerify(exactly = 1) { api.submitRsvp("evt-1", "yes") }
        coVerify(exactly = 0) { api.leaveEvent(any()) }
    }

    @Test
    fun `decline removes player from the event list`() = runTest {
        handler.handle(NotificationActionHandler.ACTION_RSVP_NO, "evt-1", null)

        coVerify(exactly = 1) { api.leaveEvent("evt-1") }
        coVerify(exactly = 0) { api.submitRsvp(any(), any()) }
    }

    @Test
    fun `join triggers quick join`() = runTest {
        handler.handle(NotificationActionHandler.ACTION_JOIN, "evt-1", null)

        coVerify(exactly = 1) { api.quickJoin("evt-1") }
    }

    @Test
    fun `confirm payment marks player paid`() = runTest {
        handler.handle(NotificationActionHandler.ACTION_CONFIRM_PAYMENT, "evt-1", "José")

        coVerify(exactly = 1) { api.updatePaymentStatus("evt-1", "José", "paid") }
    }

    @Test
    fun `confirm payment without player name is a no-op`() = runTest {
        handler.handle(NotificationActionHandler.ACTION_CONFIRM_PAYMENT, "evt-1", null)

        coVerify(exactly = 0) { api.updatePaymentStatus(any(), any(), any()) }
    }

    @Test
    fun `API failures are swallowed and never crash the receiver`() = runTest {
        coEvery { api.leaveEvent(any()) } throws RuntimeException("HTTP 401")

        // Must not throw — BroadcastReceiver would otherwise crash the app process.
        handler.handle(NotificationActionHandler.ACTION_RSVP_NO, "evt-1", null)

        coVerify(exactly = 1) { api.leaveEvent("evt-1") }
    }
}
