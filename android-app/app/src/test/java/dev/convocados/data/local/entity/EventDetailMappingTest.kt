package dev.convocados.data.local.entity

import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.TeamMember
import dev.convocados.data.api.TeamResult
import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class EventDetailMappingTest {

    private fun event(teams: List<TeamResult>?) = EventDetail(
        id = "e1", title = "Game", location = "Pitch", dateTime = "2024-01-01T10:00:00Z",
        maxPlayers = 10, ownerId = "u1", isAdmin = true, teamResults = teams,
    )

    @Test
    fun `toEntity serializes generated teams to JSON`() {
        val teams = listOf(
            TeamResult(id = "t1", name = "Ninjas", members = listOf(TeamMember("m1", "Ana", 0), TeamMember("m2", "Beto", 1))),
            TeamResult(id = "t2", name = "Gunas", members = listOf(TeamMember("m3", "Caio", 0))),
        )
        val entity = event(teams).toEntity()
        assertNotNull(entity.teamResultsJson)

        // Round-trips back to the same teams (this is what EventRepository.toDomain does).
        val restored = EntityJson.decodeFromString<List<TeamResult>>(entity.teamResultsJson!!)
        assertEquals(teams, restored)
        assertEquals("Ninjas", restored[0].name)
        assertEquals(2, restored[0].members.size)
    }

    @Test
    fun `toEntity leaves teamResultsJson null when no teams`() {
        assertNull(event(null).toEntity().teamResultsJson)
        assertNull(event(emptyList()).toEntity().teamResultsJson?.let {
            EntityJson.decodeFromString<List<TeamResult>>(it).ifEmpty { null }
        })
    }
}
