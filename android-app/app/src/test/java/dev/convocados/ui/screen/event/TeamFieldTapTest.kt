package dev.convocados.ui.screen.event

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A tap must target the opposite half. Getting this wrong makes the move a
 * no-op (`movePlayerToTeam` returns early when the target is the current team),
 * so the player would see a dead token.
 */
class TeamFieldTapTest {
    @Test
    fun `a tap on the top half moves the player to team two`() {
        assertFalse(tapMovesToTeamOne(0))
    }

    @Test
    fun `a tap on the bottom half moves the player to team one`() {
        assertTrue(tapMovesToTeamOne(1))
    }
}
