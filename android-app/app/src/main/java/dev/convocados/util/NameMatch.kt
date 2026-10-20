package dev.convocados.util

import dev.convocados.data.api.Player
import dev.convocados.data.api.UserProfile

private val CombiningMarks = "[\u0300-\u036f]".toRegex()

/**
 * The repo's own name normalization — the Kotlin twin of `normalizeForMatch` in
 * `src/lib/stringMatch.ts`: NFD, strip combining marks, lowercase. Web and Android
 * must resolve a display name the same way.
 */
fun normalizeForMatch(value: String): String =
    java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFD)
        .replace(CombiningMarks, "")
        .lowercase()

/**
 * Which row of the CURRENT roster is the signed-in user (#1269 — self-leave on an
 * unlinked row). A row carries a `userId` only when it is linked to an account, so
 * matching on `userId` alone leaves an organizer-added anonymous player with no
 * self-leave affordance. With no linked row, fall back to the normalized name —
 * but only on rows that are unlinked: a name is the strongest claim available and
 * guessing that a row belongs to someone else's account is not allowed.
 *
 * Grants no new authority: an unlinked row is removable by any viewer already (the
 * X), so this only names a row the X could remove.
 */
fun findSelfRosterRow(players: List<Player>, viewer: UserProfile?): Player? {
    if (viewer == null || viewer.id.isEmpty()) return null
    players.firstOrNull { it.userId == viewer.id }?.let { return it }
    if (viewer.name.isBlank()) return null
    val wanted = normalizeForMatch(viewer.name)
    return players.firstOrNull { it.userId == null && normalizeForMatch(it.name) == wanted }
}
