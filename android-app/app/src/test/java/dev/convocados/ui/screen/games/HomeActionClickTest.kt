package dev.convocados.ui.screen.games

import dev.convocados.data.api.HomeAction
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * ADR 0041 "Needs you" routing: `pay_share` opens settlement for the event,
 * every other action opens the event itself.
 */
class HomeActionClickTest {

    private fun action(type: String) = HomeAction(
        type = type,
        eventId = "event-1",
        eventTitle = "Sunday match",
        dateTime = "2026-10-04T10:00:00Z",
    )

    @Test
    fun `pay_share opens payments for the event`() {
        val opened = mutableListOf<String>()
        val paid = mutableListOf<String>()

        homeActionClick(action("pay_share"), { opened.add(it) }, { paid.add(it) }).invoke()

        assertEquals(listOf("event-1"), paid)
        assertEquals(emptyList<String>(), opened)
    }

    @Test
    fun `other actions open the event`() {
        val opened = mutableListOf<String>()
        val paid = mutableListOf<String>()

        homeActionClick(action("fill_spots"), { opened.add(it) }, { paid.add(it) }).invoke()

        assertEquals(listOf("event-1"), opened)
        assertEquals(emptyList<String>(), paid)
    }

    @Test
    fun `settle_score opens the event, not payments`() {
        val opened = mutableListOf<String>()
        val paid = mutableListOf<String>()

        homeActionClick(action("settle_score"), { opened.add(it) }, { paid.add(it) }).invoke()

        assertEquals(listOf("event-1"), opened)
        assertEquals(emptyList<String>(), paid)
    }

    @Test
    fun `each click opens the event again`() {
        val opened = mutableListOf<String>()

        val onClick = homeActionClick(action("vote_mvp"), { opened.add(it) }, { })
        onClick()
        onClick()

        assertEquals(listOf("event-1", "event-1"), opened)
    }
}
