package dev.convocados.ui.screen.event

import dev.convocados.data.api.TeamMember
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TeamFormationLayoutTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `members whose slots arrive out of sequence render in slot order`() {
        val layout = applyFormationLayout(
            members = listOf(
                TeamMember("m5", "Diana", 4, slot = 3),
                TeamMember("m2", "Beto", 1, slot = 1),
                TeamMember("m1", "Ana", 0, slot = 4),
                TeamMember("m4", "Elsa", 3, slot = 0),
                TeamMember("m3", "Caio", 2, slot = 2),
            ),
            slotCount = 5,
        )

        assertEquals(listOf(0, 1, 2, 3, 4), layout.placed.map { it.slot })
        assertEquals(
            listOf("Elsa", "Beto", "Caio", "Diana", "Ana"),
            layout.placed.map { it.member.name },
        )
        assertEquals(emptyList<TeamMember>(), layout.unplaced)
    }

    @Test
    fun `a member with no slot lands in the bench while a fully placed team has none`() {
        val fullyPlaced = listOf(
            TeamMember("m1", "Ana", 0, slot = 0),
            TeamMember("m2", "Beto", 1, slot = 1),
            TeamMember("m3", "Caio", 2, slot = 2),
        )
        val withBench = listOf(
            TeamMember("m1", "Ana", 0, slot = 0),
            TeamMember("m2", "Beto", 1, slot = null),
            TeamMember("m3", "Caio", 2, slot = 2),
        )

        assertEquals(emptyList<TeamMember>(), applyFormationLayout(fullyPlaced, slotCount = 3).unplaced)

        val layout = applyFormationLayout(withBench, slotCount = 3)
        assertEquals(listOf("Beto"), layout.unplaced.map { it.name })
        assertEquals(listOf("Ana", "Caio"), layout.placed.map { it.member.name })
    }

    @Test
    fun `a slot outside the formation puts the member on the bench`() {
        val layout = applyFormationLayout(
            members = listOf(
                TeamMember("m1", "Ana", 0, slot = 0),
                TeamMember("m2", "Beto", 1, slot = 9),
            ),
            slotCount = 2,
        )

        assertEquals(listOf("Ana"), layout.placed.map { it.member.name })
        assertEquals(listOf("Beto"), layout.unplaced.map { it.name })
    }

    @Test
    fun `a slot two members claim is filled once and the duplicate is benched`() {
        val layout = applyFormationLayout(
            members = listOf(
                TeamMember("m1", "Ana", 0, slot = 0),
                TeamMember("m2", "Beto", 1, slot = 0),
            ),
            slotCount = 2,
        )

        assertEquals(listOf("Ana"), layout.placed.map { it.member.name })
        assertEquals(listOf("Beto"), layout.unplaced.map { it.name })
    }

    @Test
    fun `a cached team whose payload has no slot field renders on the pitch`() {
        val members: List<TeamMember> = json.decodeFromString(
            """[{"id":"m1","name":"Ana","order":0},{"id":"m2","name":"Beto","order":1},{"id":"m3","name":"Caio","order":2}]"""
        )
        assertTrue(members.all { it.slot == null })

        val layout = applyFormationLayout(members, slotCount = 2)

        // Every member still renders: the first two on slots, the rest on the bench.
        assertEquals(listOf("Ana", "Beto"), layout.placed.map { it.member.name })
        assertEquals(listOf("Caio"), layout.unplaced.map { it.name })
    }
}
