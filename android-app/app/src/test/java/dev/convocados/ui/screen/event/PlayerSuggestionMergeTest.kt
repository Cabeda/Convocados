package dev.convocados.ui.screen.event

import dev.convocados.data.api.CoPlayer
import dev.convocados.data.api.KnownPlayer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerSuggestionMergeTest {

    @Test
    fun `merge keeps event history first with per-event count`() {
        val merged = mergePlayerSuggestions(
            known = listOf(KnownPlayer("Marta", 12)),
            coPlayers = emptyList(),
            currentNames = emptySet(),
        )
        assertEquals(1, merged.size)
        assertEquals("Marta", merged[0].name)
        assertEquals(12, merged[0].gamesPlayedHere)
        assertEquals(0, merged[0].coPlayCount)
        assertEquals(SuggestionSource.EVENT, merged[0].source)
    }

    @Test
    fun `merge adds global co-players not present in event history`() {
        val merged = mergePlayerSuggestions(
            known = listOf(KnownPlayer("Marta", 12)),
            coPlayers = listOf(CoPlayer("Rui", "u-rui", null, 5), CoPlayer("Sofia", "u-sof", null, 2)),
            currentNames = emptySet(),
        )
        assertEquals(3, merged.size)
        val rui = merged.first { it.name == "Rui" }
        assertEquals(0, rui.gamesPlayedHere)
        assertEquals(5, rui.coPlayCount)
        assertEquals(SuggestionSource.CO_PLAY, rui.source)
    }

    @Test
    fun `event history wins on name collision and gains co-play count`() {
        val merged = mergePlayerSuggestions(
            known = listOf(KnownPlayer("Marta", 12)),
            coPlayers = listOf(CoPlayer("Marta", "u-marta", null, 7)),
            currentNames = emptySet(),
        )
        assertEquals(1, merged.size)
        val marta = merged[0]
        assertEquals(12, marta.gamesPlayedHere)
        assertEquals(7, marta.coPlayCount)
        assertEquals(SuggestionSource.EVENT, marta.source)
    }

    @Test
    fun `current roster players are excluded`() {
        val merged = mergePlayerSuggestions(
            known = listOf(KnownPlayer("Marta", 12), KnownPlayer("OnRoster", 3)),
            coPlayers = listOf(CoPlayer("AlsoOnRoster", "u-a", null, 4)),
            currentNames = setOf("onroster", "alsoonroster"),
        )
        assertEquals(listOf("Marta"), merged.map { it.name })
    }

    @Test
    fun `merged list sorted by total relevance desc`() {
        val merged = mergePlayerSuggestions(
            known = listOf(KnownPlayer("Rare", 1), KnownPlayer("Frequent", 9)),
            coPlayers = listOf(CoPlayer("MidCoPlay", "u-m", null, 4)),
            currentNames = emptySet(),
        )
        assertEquals(listOf("Frequent", "MidCoPlay", "Rare"), merged.map { it.name })
    }

    @Test
    fun `name matching is case insensitive`() {
        val merged = mergePlayerSuggestions(
            known = listOf(KnownPlayer("Marta", 12)),
            coPlayers = listOf(CoPlayer("MARTA", "u-marta", null, 7)),
            currentNames = emptySet(),
        )
        assertEquals(1, merged.size)
        assertEquals(7, merged[0].coPlayCount)
    }

    @Test
    fun `capped at 30 suggestions`() {
        val known = (0..24).map { KnownPlayer("K$it", it) }
        val coPlayers = (0..24).map { CoPlayer("C$it", "u-$it", null, it) }
        val merged = mergePlayerSuggestions(known, coPlayers, emptySet())
        assertTrue(merged.size <= 30)
    }
}
