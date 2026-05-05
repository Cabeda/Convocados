package dev.convocados.wear.util

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import kotlin.math.abs

/** Parse an ISO date-time string to [Instant], tolerating both zoned and UTC formats. */
fun parseInstant(dateTime: String): Instant? = try {
    ZonedDateTime.parse(dateTime, DateTimeFormatter.ISO_DATE_TIME).toInstant()
} catch (_: Exception) {
    try { Instant.parse(dateTime) } catch (_: Exception) { null }
}

/** Whether a game can be scored: within 1 hour before start, or any time after. */
fun canScoreGame(dateTime: String): Boolean {
    val instant = parseInstant(dateTime) ?: return false
    val minutesUntil = ChronoUnit.MINUTES.between(Instant.now(), instant)
    return minutesUntil <= 60
}

/** Whether a past game should be hidden from the main list.
 *  Non-recurring games older than 1 day are hidden from the upcoming view. */
fun isStalePastGame(dateTime: String, isRecurring: Boolean): Boolean {
    if (isRecurring) return false
    val instant = parseInstant(dateTime) ?: return true
    val minutesAgo = ChronoUnit.MINUTES.between(instant, Instant.now())
    return minutesAgo > 1440 // more than 1 day ago
}

/** Human-friendly relative time label for wear UI. */
fun formatRelativeTime(dateTime: String): String {
    val instant = parseInstant(dateTime) ?: return dateTime
    val now = Instant.now()
    val minutes = ChronoUnit.MINUTES.between(now, instant)

    return when {
        minutes in -120..0 -> "In progress"
        minutes in 1..59 -> "In ${minutes}m"
        minutes in 60..1440 -> "In ${minutes / 60}h ${minutes % 60}m"
        minutes > 1440 -> {
            val zoned = instant.atZone(ZoneId.systemDefault())
            zoned.format(DateTimeFormatter.ofPattern("EEE HH:mm"))
        }
        minutes in -1440..-121 -> {
            val ago = abs(minutes)
            "${ago / 60}h ago"
        }
        else -> {
            val zoned = instant.atZone(ZoneId.systemDefault())
            zoned.format(DateTimeFormatter.ofPattern("MMM d"))
        }
    }
}
