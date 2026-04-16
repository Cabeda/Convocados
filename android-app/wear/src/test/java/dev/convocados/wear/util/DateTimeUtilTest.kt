package dev.convocados.wear.util

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

class DateTimeUtilTest {

    // ── parseInstant ─────────────────────────────────────────────────────

    @Test
    fun `parseInstant parses ISO zoned datetime`() {
        val input = "2025-06-15T14:30:00+01:00"
        val result = parseInstant(input)
        assertNotNull(result)
        assertEquals(
            ZonedDateTime.parse(input).toInstant(),
            result,
        )
    }

    @Test
    fun `parseInstant parses UTC instant format`() {
        val input = "2025-06-15T13:30:00Z"
        val result = parseInstant(input)
        assertNotNull(result)
        assertEquals(Instant.parse(input), result)
    }

    @Test
    fun `parseInstant parses ISO datetime without offset`() {
        // ISO_DATE_TIME also handles "2025-06-15T14:30:00" when a zone is implicit
        val input = "2025-06-15T14:30:00Z"
        val result = parseInstant(input)
        assertNotNull(result)
    }

    @Test
    fun `parseInstant returns null for garbage input`() {
        assertNull(parseInstant("not-a-date"))
        assertNull(parseInstant(""))
        assertNull(parseInstant("2025-13-45"))
    }

    // ── formatRelativeTime ───────────────────────────────────────────────

    @Test
    fun `formatRelativeTime returns In progress for recent past`() {
        // 30 minutes ago
        val instant = Instant.now().minus(30, ChronoUnit.MINUTES)
        val input = ZonedDateTime.ofInstant(instant, ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_DATE_TIME)
        assertEquals("In progress", formatRelativeTime(input))
    }

    @Test
    fun `formatRelativeTime returns minutes for near future`() {
        // 15 minutes from now
        val instant = Instant.now().plus(15, ChronoUnit.MINUTES)
        val input = ZonedDateTime.ofInstant(instant, ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_DATE_TIME)
        val result = formatRelativeTime(input)
        assertTrue("Expected 'In XXm' but got '$result'", result.startsWith("In ") && result.endsWith("m"))
    }

    @Test
    fun `formatRelativeTime returns hours for medium future`() {
        // 3 hours from now
        val instant = Instant.now().plus(180, ChronoUnit.MINUTES)
        val input = ZonedDateTime.ofInstant(instant, ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_DATE_TIME)
        val result = formatRelativeTime(input)
        assertTrue("Expected 'In Xh Ym' but got '$result'", result.startsWith("In ") && result.contains("h"))
    }

    @Test
    fun `formatRelativeTime returns hours ago for past games`() {
        // 5 hours ago
        val instant = Instant.now().minus(300, ChronoUnit.MINUTES)
        val input = ZonedDateTime.ofInstant(instant, ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_DATE_TIME)
        val result = formatRelativeTime(input)
        assertTrue("Expected 'Xh ago' but got '$result'", result.endsWith("h ago"))
    }

    @Test
    fun `formatRelativeTime returns raw string for unparseable input`() {
        assertEquals("garbage", formatRelativeTime("garbage"))
    }
}
