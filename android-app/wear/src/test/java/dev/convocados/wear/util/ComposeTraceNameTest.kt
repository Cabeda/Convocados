package dev.convocados.wear.util

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Covers the shortening the Compose tracing marker passes through before it
 * reaches `Trace.beginSection`. The compiler emits
 * `fully.qualified.Name.<anonymous>.<anonymous> (File.kt:line)`, which overflows
 * atrace's 127-char section-name limit; a truncated (or unbalanced) section name
 * silently corrupts the whole trace, so the shortening has to be total.
 */
class ComposeTraceNameTest {

    @Test
    fun `keeps type and source location for a named composable`() {
        val marker = "dev.convocados.wear.ui.screen.games.GameChip (GamesScreen.kt:383)"

        assertEquals("GameChip (GamesScreen.kt:383)", composeTraceSectionName(marker))
    }

    @Test
    fun `drops the anonymous lambda chain for lambda scopes`() {
        val marker =
            "dev.convocados.wear.ui.screen.games.GamesScreen.<anonymous>.<anonymous>." +
                "<anonymous>.<anonymous>.<anonymous> (GamesScreen.kt:205)"

        assertEquals("GamesScreen (GamesScreen.kt:205)", composeTraceSectionName(marker))
    }

    @Test
    fun `distinguishes sibling lambdas by line number`() {
        val first = "dev.convocados.wear.ui.screen.games.GamesScreen.<anonymous> (GamesScreen.kt:224)"
        val second = "dev.convocados.wear.ui.screen.games.GamesScreen.<anonymous> (GamesScreen.kt:269)"

        assertEquals("GamesScreen (GamesScreen.kt:224)", composeTraceSectionName(first))
        assertEquals("GamesScreen (GamesScreen.kt:269)", composeTraceSectionName(second))
    }

    @Test
    fun `substitutes a placeholder for an empty marker so begin and end stay paired`() {
        assertEquals("?", composeTraceSectionName(""))
    }

    @Test
    fun `falls back to the simple name when the marker carries no location`() {
        assertEquals("GameChip", composeTraceSectionName("dev.convocados.wear.ui.GameChip"))
    }

    @Test
    fun `truncates to the atrace section-name limit`() {
        val longType = "A".repeat(120)
        val marker = "dev.convocados.wear.ui.screen.$longType (SomeFile.kt:1234)"

        val result = composeTraceSectionName(marker)

        assertEquals(ATRACE_SECTION_NAME_LIMIT, result.length)
    }
}
