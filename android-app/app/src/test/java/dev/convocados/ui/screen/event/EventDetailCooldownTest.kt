package dev.convocados.ui.screen.event

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant

class EventDetailCooldownTest {

    @Test
    fun `null notifiedAt means resend is eligible`() {
        assertNull(resendCooldownRemaining(null))
        assertNull(resendCooldownRemaining(""))
    }

    @Test
    fun `cooldown within 24h returns remaining duration`() {
        val twoHoursAgo = Instant.now().minus(Duration.ofHours(2)).toString()
        val remaining = resendCooldownRemaining(twoHoursAgo)
        assertTrue(remaining != null)
        assertTrue(remaining!! > Duration.ZERO)
        assertTrue(remaining < Duration.ofHours(24))
        assertTrue(remaining <= Duration.ofHours(22))
    }

    @Test
    fun `cooldown elapsed after 24h returns null`() {
        val beyond = Instant.now().minus(Duration.ofHours(25)).toString()
        assertNull(resendCooldownRemaining(beyond))
    }

    @Test
    fun `formatCooldownRemaining renders minutes and hours`() {
        assertEquals("42m", formatCooldownRemaining(Duration.ofMinutes(42)))
        assertEquals("1h 5m", formatCooldownRemaining(Duration.ofMinutes(65)))
        assertEquals("1m", formatCooldownRemaining(Duration.ofSeconds(30)))
    }
}
