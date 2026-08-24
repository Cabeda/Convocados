package dev.convocados.data.push

import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * Builds the detail line shown under the invite message so the user can decide
 * accept/decline from the notification itself: "<sport> · <local time> · <place>".
 *
 * Pure and unit-testable — no Android framework types.
 */
object InviteNotificationFormatter {

    /**
     * @param sport raw sport id from the API, e.g. "football-5v5", "padel"
     * @param startsAt ISO-8601 instant of kickoff
     * @param location venue name/address, may be blank
     */
    fun buildDetailLine(
        sport: String?,
        startsAt: String?,
        location: String?,
        zoneId: ZoneId = ZoneId.systemDefault(),
    ): String {
        val parts = mutableListOf<String>()

        sport?.trim()?.takeIf { it.isNotEmpty() }?.let { parts.add(humanizeSport(it)) }

        if (!startsAt.isNullOrBlank()) {
            runCatching {
                val dt = java.time.OffsetDateTime.parse(startsAt)
                    .atZoneSameInstant(zoneId)
                DateTimeFormatter.ofPattern("EEE d MMM, HH:mm").format(dt)
            }.getOrNull()?.let { parts.add(it) }
        }

        location?.trim()?.takeIf { it.isNotEmpty() }?.let { parts.add(it) }

        return parts.joinToString(" · ")
    }

    /** "football-5v5" → "Football 5v5"; capitalizes dash-separated words. */
    fun humanizeSport(sport: String): String =
        sport.trim().split("-", " ").filter { it.isNotBlank() }
            .joinToString(" ") { w ->
                w.replaceFirstChar { c -> c.uppercase() }
            }

    /** Full notification text: invite message + newline + detail line. */
    fun buildBigText(inviteBody: String, detailLine: String): String =
        if (detailLine.isBlank()) inviteBody else "$inviteBody\n$detailLine"
}
