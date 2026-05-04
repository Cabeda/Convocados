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

    // ── canScoreGame ──────────────────────────────────────────────────────

    @Test
    fun `canScoreGame returns true for game starting now`() {
        val instant = Instant.now()
        val input = ZonedDateTime.ofInstant(instant, ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_DATE_TIME)
        assertTrue(canScoreGame(input))
    }

    @Test
    fun `canScoreGame returns true for game starting in 30 minutes`() {
        val instant = Instant.now().plus(30, ChronoUnit.MINUTES)
        val input = ZonedDateTime.ofInstant(instant, ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_DATE_TIME)
        assertTrue(canScoreGame(input))
    }

    @Test
    fun `canScoreGame returns true for game starting in exactly 60 minutes`() {
        val instant = Instant.now().plus(60, ChronoUnit.MINUTES)
        val input = ZonedDateTime.ofInstant(instant, ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_DATE_TIME)
        assertTrue(canScoreGame(input))
    }

    @Test
    fun `canScoreGame returns false for game well over 1 hour away`() {
        val instant = Instant.now().plus(90, ChronoUnit.MINUTES)
        val input = ZonedDateTime.ofInstant(instant, ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_DATE_TIME)
        assertFalse(canScoreGame(input))
    }

    @Test
    fun `canScoreGame returns false for game starting in 2 hours`() {
        val instant = Instant.now().plus(120, ChronoUnit.MINUTES)
        val input = ZonedDateTime.ofInstant(instant, ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_DATE_TIME)
        assertFalse(canScoreGame(input))
    }

    @Test
    fun `canScoreGame returns true for game that already started`() {
        val instant = Instant.now().minus(30, ChronoUnit.MINUTES)
        val input = ZonedDateTime.ofInstant(instant, ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_DATE_TIME)
        assertTrue(canScoreGame(input))
    }

    @Test
    fun `canScoreGame returns false for unparseable input`() {
        assertFalse(canScoreGame("garbage"))
    }

    // ── isStalePastGame ──────────────────────────────────────────────────

    @Test
    fun `isStalePastGame returns false for recurring game regardless of age`() {
        val instant = Instant.now().minus(7, ChronoUnit.DAYS)
        val input = ZonedDateTime.ofInstant(instant, ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_DATE_TIME)
        assertFalse(isStalePastGame(input, true))
    }

    @Test
    fun `isStalePastGame returns false for non-recurring game less than 1 day old`() {
        val instant = Instant.now().minus(30, ChronoUnit.MINUTES)
        val input = ZonedDateTime.ofInstant(instant, ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_DATE_TIME)
        assertFalse(isStalePastGame(input, false))
    }

    @Test
    fun `isStalePastGame returns true for non-recurring game more than 1 day old`() {
        val instant = Instant.now().minus(2, ChronoUnit.DAYS)
        val input = ZonedDateTime.ofInstant(instant, ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_DATE_TIME)
        assertTrue(isStalePastGame(input, false))
    }

    @Test
    fun `isStalePastGame returns false for future game`() {
        val instant = Instant.now().plus(1, ChronoUnit.HOURS)
        val input = ZonedDateTime.ofInstant(instant, ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_DATE_TIME)
        assertFalse(isStalePastGame(input, false))
    }

    @Test
    fun `isStalePastGame returns true for unparseable input`() {
        assertTrue(isStalePastGame("garbage", false))
    }
}
