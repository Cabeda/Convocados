package dev.convocados.ui.screen.event

import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.Player
import org.junit.Assert.assertTrue
import org.junit.Test

class EventShareTextTest {

    private fun event(players: Int, location: String = "Campo") = EventDetail(
        id = "evt-1",
        title = "Monday Football",
        location = location,
        dateTime = "2026-11-27T18:00:00Z",
        timezone = "UTC",
        maxPlayers = 10,
        sport = "football-5v5",
        players = List(players) { Player(id = "p$it", name = "P$it", order = it) },
    )

    @Test
    fun `share text carries the event link and the recruitment spot count`() {
        val text = eventShareText(event(players = 7), "https://convocados.cabeda.dev/events/evt-1")

        assertTrue(text.contains("Monday Football"))
        assertTrue(text.contains("Campo"))
        assertTrue(text.contains("3 spot(s) left"))
        assertTrue(text.contains("https://convocados.cabeda.dev/events/evt-1"))
    }
}
