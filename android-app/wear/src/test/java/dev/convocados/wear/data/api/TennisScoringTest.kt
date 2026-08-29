package dev.convocados.wear.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TennisScoringTest {

    @Test
    fun `points advance from love through fifteen thirty and forty`() {
        var score = TennisGameScore()

        score = advanceTennisPoint(score, TennisTeam.ONE).score
        assertEquals(TennisPoint.FIFTEEN, score.teamOne)
        score = advanceTennisPoint(score, TennisTeam.ONE).score
        assertEquals(TennisPoint.THIRTY, score.teamOne)
        score = advanceTennisPoint(score, TennisTeam.ONE).score
        assertEquals(TennisPoint.FORTY, score.teamOne)
    }

    @Test
    fun `forty thirty winner completes the game and resets points`() {
        val score = TennisGameScore(TennisPoint.FORTY, TennisPoint.THIRTY)

        val result = advanceTennisPoint(score, TennisTeam.ONE)

        assertEquals(TennisGameScore(), result.score)
        assertEquals(TennisTeam.ONE, result.completedTeam)
    }

    @Test
    fun `forty forty enters deuce then advantage`() {
        val deuce = TennisGameScore(TennisPoint.FORTY, TennisPoint.FORTY)

        val result = advanceTennisPoint(deuce, TennisTeam.ONE)

        assertEquals(TennisGameScore(TennisPoint.ADVANTAGE, TennisPoint.FORTY), result.score)
        assertEquals("Deuce", displayTennisPoint(deuce))
        assertEquals("AD", displayTennisPointForTeam(result.score, TennisTeam.ONE))
    }

    @Test
    fun `losing advantage returns to deuce`() {
        val advantage = TennisGameScore(TennisPoint.ADVANTAGE, TennisPoint.FORTY)

        val result = advanceTennisPoint(advantage, TennisTeam.TWO)

        assertEquals(TennisGameScore(TennisPoint.FORTY, TennisPoint.FORTY), result.score)
        assertNull(result.completedTeam)
    }

    @Test
    fun `advantage winner completes the game and resets points`() {
        val advantage = TennisGameScore(TennisPoint.FORTY, TennisPoint.ADVANTAGE)

        val result = advanceTennisPoint(advantage, TennisTeam.TWO)

        assertEquals(TennisGameScore(), result.score)
        assertEquals(TennisTeam.TWO, result.completedTeam)
    }

    @Test
    fun `decrementing a fresh set stays at love`() {
        val rewound = rewindTennisSetPoint(SetScore(0, 0), TennisTeam.ONE)

        assertEquals(SetScore(0, 0), rewound)
    }

    @Test
    fun `decrementing an active game back to love cannot decrement again`() {
        val onePoint = SetScore(0, 0, pointTeamOne = 1, pointTeamTwo = 0, pointGameActive = true)

        val backAtLove = rewindTennisSetPoint(onePoint, TennisTeam.ONE)
        val unchanged = rewindTennisSetPoint(backAtLove, TennisTeam.ONE)

        assertEquals(SetScore(0, 0, pointTeamOne = 0, pointTeamTwo = 0, pointGameActive = true), backAtLove)
        assertEquals(backAtLove, unchanged)
    }

    @Test
    fun `completed-game reset remains distinguishable from active love`() {
        val completedGameReset = SetScore(teamOne = 1, teamTwo = 0, pointTeamOne = 0, pointTeamTwo = 0)

        val rewound = rewindTennisSetPoint(completedGameReset, TennisTeam.ONE)

        assertEquals(0, rewound.teamOne)
        assertEquals(3, rewound.pointTeamOne)
        assertEquals(3, rewound.pointTeamTwo)
    }

    @Test
    fun `legacy structured game decrement preserves set score compatibility`() {
        val legacySet = SetScore(teamOne = 3, teamTwo = 2)

        assertEquals(SetScore(teamOne = 2, teamTwo = 2), rewindTennisSetPoint(legacySet, TennisTeam.ONE))
        assertEquals(SetScore(teamOne = 3, teamTwo = 1), rewindTennisSetPoint(legacySet, TennisTeam.TWO))
    }

    @Test
    fun `rewinding the opposite side of advantage keeps a valid score`() {
        val teamTwoAdvantage = TennisGameScore(TennisPoint.FORTY, TennisPoint.ADVANTAGE)
        val teamOneAdvantage = TennisGameScore(TennisPoint.ADVANTAGE, TennisPoint.FORTY)

        assertEquals(teamTwoAdvantage, rewindTennisPoint(teamTwoAdvantage, TennisTeam.ONE))
        assertEquals(teamOneAdvantage, rewindTennisPoint(teamOneAdvantage, TennisTeam.TWO))
    }

    @Test
    fun `completed game can only be rewound by the recorded winner`() {
        val completedGameReset = SetScore(
            teamOne = 1,
            teamTwo = 0,
            pointTeamOne = 0,
            pointTeamTwo = 0,
            pointGameCompletedBy = TennisTeam.ONE.serializedValue,
        )

        assertEquals(completedGameReset, rewindTennisSetPoint(completedGameReset, TennisTeam.TWO))
    }

    @Test
    fun `decrementing after a completed game removes that game`() {
        val set = SetScore(
            teamOne = 1,
            teamTwo = 0,
            pointTeamOne = 0,
            pointTeamTwo = 0,
            pointGameCompletedBy = TennisTeam.ONE.serializedValue,
        )

        val rewound = rewindTennisSetPoint(set, TennisTeam.ONE)

        assertEquals(0, rewound.teamOne)
        assertEquals(3, rewound.pointTeamOne)
        assertEquals(3, rewound.pointTeamTwo)
    }
}
