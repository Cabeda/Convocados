package dev.convocados.ui.screen.event

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TeamFormationsTest {

    @Test
    fun football5v5_offersThreeFormations() {
        val formations = formationsForSport("football-5v5")
        assertEquals(listOf("2-2", "1-2-1", "3-1"), formations.map { it.id })
        assertTrue(formations.all { it.slots.size == 5 })
    }

    @Test
    fun defaultFormation_isFirstForSport() {
        assertEquals("2-3-1", defaultFormation("football-7v7").id)
        assertEquals("2-2", defaultFormation("football-5v5").id)
    }

    @Test
    fun unknownSport_fallsBackToGeneric() {
        assertEquals(defaultFormation("other"), defaultFormation("kabaddi"))
        assertEquals(defaultFormation(null), defaultFormation("kabaddi"))
    }

    @Test
    fun allSlotsStayWithinUnitSquare() {
        for (sport in listOf("football-11v11", "basketball", "volleyball", "other", null)) {
            for (formation in formationsForSport(sport)) {
                for (slot in formation.slots) {
                    assertTrue("x out of range: ${slot.x}", slot.x in 0f..1f)
                    assertTrue("y out of range: ${slot.y}", slot.y in 0f..1f)
                }
            }
        }
    }

    @Test
    fun basePitchFraction_mapsHalvesToOwnGoal() {
        assertEquals(0f, basePitchFraction(0, 0f), 0.0001f)
        assertEquals(0.5f, basePitchFraction(0, 1f), 0.0001f)
        assertEquals(1f, basePitchFraction(1, 0f), 0.0001f)
        assertEquals(0.5f, basePitchFraction(1, 1f), 0.0001f)
    }

    @Test
    fun targetTeamForDrag_crossesHalfwayLine() {
        assertEquals(0, targetTeamForDrag(0.45f, 10f, 400))
        assertEquals(1, targetTeamForDrag(0.45f, 40f, 400))
        assertEquals(1, targetTeamForDrag(0.55f, -10f, 400))
        assertEquals(0, targetTeamForDrag(0.55f, -40f, 400))
    }

    @Test
    fun targetTeamForDrag_unmeasuredPitchReturnsNoTarget() {
        assertEquals(-1, targetTeamForDrag(0.5f, 100f, 0))
    }

    @Test
    fun racketSports_haveDoublesAndSingles() {
        assertEquals(2, defaultFormation("padel").slots.size)
        assertEquals(2, defaultFormation("tennis-doubles").slots.size)
        assertEquals(1, defaultFormation("tennis-singles").slots.size)
        assertEquals(1, defaultFormation("squash").slots.size)
    }
}
