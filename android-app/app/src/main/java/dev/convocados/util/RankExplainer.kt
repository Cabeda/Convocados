package dev.convocados.util

import kotlin.math.roundToLong

/**
 * Win/draw/loss from team one's point of view. Mirrors the web
 * `outcomeFromScore` — `1` win, `0.5` draw, `0` loss.
 */
fun outcomeFromScore(scoreOne: Int?, scoreTwo: Int?): Double {
    if (scoreOne == null || scoreTwo == null) return 0.5
    if (scoreOne > scoreTwo) return 1.0
    if (scoreOne < scoreTwo) return 0.0
    return 0.5
}

/**
 * Renders a number the way JavaScript's `String(n)` does — no trailing `.0` —
 * so the explainer URL matches the web `buildRankExplainerHref` exactly.
 */
internal fun jsNumber(value: Double): String =
    if (value == value.toLong().toDouble()) value.toLong().toString() else value.toString()

/**
 * The per-event Rank explainer URL, pre-filled with this Game's numbers so a
 * shared link reproduces the exact calculation. Mirrors the web
 * `buildRankExplainerHref`.
 */
fun buildRankExplainerUrl(
    serverUrl: String,
    eventId: String,
    seasonId: String? = null,
    rank: Double? = null,
    delta: Double? = null,
    outcome: Double? = null,
): String {
    val params = mutableListOf<String>()
    if (!seasonId.isNullOrBlank()) params += "seasonId=${encodeQuery(seasonId)}"
    if (rank != null) params += "rank=${rank.roundToLong()}"
    if (delta != null) params += "delta=${jsNumber(delta)}"
    if (outcome != null) params += "outcome=${jsNumber(outcome)}"
    val query = if (params.isEmpty()) "" else "?" + params.joinToString("&")
    return "${serverUrl.trimEnd('/')}/events/$eventId/rank-explainer$query"
}

private fun encodeQuery(value: String): String =
    java.net.URLEncoder.encode(value, "UTF-8")
