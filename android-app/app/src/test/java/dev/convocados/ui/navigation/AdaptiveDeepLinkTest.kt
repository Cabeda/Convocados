package dev.convocados.ui.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class AdaptiveDeepLinkTest {

    @Test
    fun `event deep links expose the selected event id`() {
        assertEquals("evt-abc", DeepLink.eventId("convocados://events/evt-abc?action=pay"))
        assertEquals("evt-xyz", DeepLink.eventId("https://convocados.cabeda.dev/events/evt-xyz"))
    }

    @Test
    fun `event payment deep links preserve their action`() {
        assertTrue(DeepLink.shouldAutoOpenPayment("convocados://events/evt-pay?action=pay"))
        assertTrue(DeepLink.shouldAutoOpenPayment("https://convocados.cabeda.dev/events/evt-pay?action=pay"))
        assertFalse(DeepLink.shouldAutoOpenPayment("convocados://events/evt-pay"))
        assertFalse(DeepLink.shouldAutoOpenPayment("convocados://auth?action=pay"))
    }

    @Test
    fun `pending payment action is consumed for its target event only once`() {
        assertTrue(
            DeepLink.shouldAutoOpenPaymentForEvent(
                pending = true,
                targetEventId = "evt-pay",
                deepLink = "convocados://events/evt-pay?action=pay",
            ),
        )
        assertFalse(
            DeepLink.shouldAutoOpenPaymentForEvent(
                pending = false,
                targetEventId = "evt-pay",
                deepLink = "convocados://events/evt-pay?action=pay",
            ),
        )
        assertFalse(
            DeepLink.shouldAutoOpenPaymentForEvent(
                pending = true,
                targetEventId = "evt-other",
                deepLink = "convocados://events/evt-pay?action=pay",
            ),
        )
    }

    @Test
    fun `event share deep links preserve their action`() {
        assertTrue(DeepLink.shouldAutoOpenShare("convocados://events/evt-share?action=share"))
        assertTrue(DeepLink.shouldAutoOpenShare("https://convocados.cabeda.dev/events/evt-share?action=share"))
        assertFalse(DeepLink.shouldAutoOpenShare("convocados://events/evt-share"))
        assertFalse(DeepLink.shouldAutoOpenShare("convocados://auth?action=share"))
    }

    @Test
    fun `pending share action is consumed for its target event only once`() {
        assertTrue(
            DeepLink.shouldAutoOpenShareForEvent(
                pending = true,
                targetEventId = "evt-share",
                deepLink = "convocados://events/evt-share?action=share",
            ),
        )
        assertFalse(
            DeepLink.shouldAutoOpenShareForEvent(
                pending = false,
                targetEventId = "evt-share",
                deepLink = "convocados://events/evt-share?action=share",
            ),
        )
        assertFalse(
            DeepLink.shouldAutoOpenShareForEvent(
                pending = true,
                targetEventId = "evt-other",
                deepLink = "convocados://events/evt-share?action=share",
            ),
        )
    }

    @Test
    fun `compact event click carries the pending share action`() {
        assertEquals(
            "event/evt-share?action=share",
            DeepLink.compactEventDetailRoute(
                eventId = "evt-share",
                shouldOpenPayment = false,
                shouldOpenShare = true,
            ),
        )
        assertEquals(
            "event/evt-other",
            DeepLink.compactEventDetailRoute(
                eventId = "evt-other",
                shouldOpenPayment = false,
                shouldOpenShare = false,
            ),
        )
    }

    @Test
    fun `non-event links do not select an event`() {
        assertNull(DeepLink.eventId("convocados://games"))
        assertNull(DeepLink.eventId("convocados://auth?code=abc"))
    }
}
