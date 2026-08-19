package dev.convocados.ui.screen.games

import java.util.Locale
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class DateFormatterTest {

    // 18:00 UTC == 19:00 in Europe/Lisbon (WEST, UTC+1 in summer)
    private val iso = "2026-07-13T18:00:00.000Z"

    private val originalLocale = Locale.getDefault()

    // The formatter uses the JVM default locale, which is machine/CI dependent.
    // Pin a 24-hour locale (de_DE) so the hour assertions are deterministic.
    @Before
    fun setUp() {
        Locale.setDefault(Locale.GERMANY)
    }

    @After
    fun tearDown() {
        Locale.setDefault(originalLocale)
    }

    @Test
    fun `formatEventDateInTz uses the event timezone not the device timezone`() {
        val lisbon = formatEventDateInTz(iso, "Europe/Lisbon")
        assertTrue("expected 19:00 for Lisbon, got: $lisbon", lisbon.contains("19:00"))
        assertFalse("should not show 18:00 (UTC) for Lisbon", lisbon.contains("18:00"))
    }

    @Test
    fun `formatEventDateInTz honours a different event timezone`() {
        // Europe/Paris is UTC+2 in summer -> 20:00
        val paris = formatEventDateInTz(iso, "Europe/Paris")
        assertTrue("expected 20:00 for Paris, got: $paris", paris.contains("20:00"))
    }

    @Test
    fun `formatEventDateInTz falls back to device timezone for blank value`() {
        val result = formatEventDateInTz(iso, "")
        assertTrue(result.isNotBlank())
    }
}
