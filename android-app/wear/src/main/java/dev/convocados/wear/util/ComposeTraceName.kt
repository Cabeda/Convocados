package dev.convocados.wear.util

/**
 * Maximum length of an `atrace` section name. Longer names are silently
 * truncated by the tracing implementation, and a truncated name paired with an
 * `endSection` un-winds the whole section stack, corrupting the trace.
 */
const val ATRACE_SECTION_NAME_LIMIT = 127

/**
 * Shortens a Compose compiler trace marker into an `atrace` section name.
 *
 * The Compose compiler emits markers of the form
 * `fully.qualified.Name.<anonymous>.<anonymous> (File.kt:line)`, which routinely
 * exceeds [ATRACE_SECTION_NAME_LIMIT]. Only the type and the source location
 * carry useful information — the `<anonymous>` chain is depth-only — so this
 * keeps `Type (File.kt:line)`, which is both short enough and precise enough to
 * attribute a frame's cost to a specific composable in a Perfetto trace.
 *
 * An empty marker yields `"?"` rather than an empty name so that callers can
 * always pair `beginSection` with `endSection`.
 */
fun composeTraceSectionName(marker: String): String {
    if (marker.isEmpty()) return "?"

    val locationStart = marker.lastIndexOf(" (")
    val fqn = if (locationStart >= 0) marker.substring(0, locationStart) else marker
    val location = if (locationStart >= 0) marker.substring(locationStart + 2, marker.length - 1) else ""
    val type = fqn.substringBefore('<').removeSuffix(".").substringAfterLast('.')

    return (if (location.isEmpty()) type else "$type ($location)").take(ATRACE_SECTION_NAME_LIMIT)
}
