package dev.convocados.data.api

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ModelsTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `decodes profile image on a linked player`() {
        val player = json.decodeFromString<Player>(
            """{"id":"p1","name":"Alice","order":0,"userId":"u1","image":"https://example.com/alice.jpg","createdAt":""}"""
        )
        assertEquals("https://example.com/alice.jpg", player.image)
    }

    @Test
    fun `defaults image to null when absent`() {
        val player = json.decodeFromString<Player>(
            """{"id":"p1","name":"Alice","order":0,"userId":"u1","createdAt":""}"""
        )
        assertNull(player.image)
    }

    @Test
    fun `decodes seasonRank movement on post-game status`() {
        val status = json.decodeFromString<PostGameStatus>(
            """
            {"gameEnded":true,"hasScore":true,"seasonRank":{
              "seasonId":"s1","seasonName":"Spring Season","counted":true,"delta":32,
              "before":1500,"after":1532,"tierBefore":1,"tierAfter":1,
              "provisional":false,"gamesThisSeason":5,
              "edges":[0,1000,1600,2000,2300,2600]}}
            """.trimIndent()
        )
        val rank = status.seasonRank!!
        assertEquals("s1", rank.seasonId)
        assertEquals("Spring Season", rank.seasonName)
        assertEquals(true, rank.counted)
        assertEquals(32.0, rank.delta, 0.0)
        assertEquals(1500.0, rank.before, 0.0)
        assertEquals(1532.0, rank.after, 0.0)
        assertEquals(1, rank.tierBefore)
        assertEquals(1, rank.tierAfter)
        assertEquals(false, rank.provisional)
        assertEquals(5, rank.gamesThisSeason)
        assertEquals(listOf(0.0, 1000.0, 1600.0, 2000.0, 2300.0, 2600.0), rank.edges)
    }

    @Test
    fun `decodes provisional seasonRank and defaults missing fields`() {
        val status = json.decodeFromString<PostGameStatus>(
            """{"seasonRank":{"seasonId":"s1","counted":true,"provisional":true,"gamesThisSeason":2}}"""
        )
        val rank = status.seasonRank!!
        assertEquals(true, rank.provisional)
        assertEquals(0.0, rank.delta, 0.0)
        assertEquals(0.0, rank.after, 0.0)
        assertEquals(emptyList<Double>(), rank.edges)
    }

    @Test
    fun `defaults seasonRank to null when absent`() {
        val status = json.decodeFromString<PostGameStatus>("""{"gameEnded":true}""")
        assertNull(status.seasonRank)
    }

    @Test
    fun `decodes rankStanding crew pointsDelta and result-card fields`() {
        val status = json.decodeFromString<PostGameStatus>(
            """
            {"scoreOne":3,"scoreTwo":1,"teamOneName":"Demo Team","teamTwoName":"Rivals",
             "viewerPaymentSettled":true,
             "rankStanding":{"seasonId":"s1","seasonName":"Spring","rank":1168,"tier":4,
               "provisional":false,"gamesThisSeason":5,"edges":[0,900,1300],
               "crew":{"crewId":"c1","name":"Vermelhos","place":1,"placeCount":2,
                       "points":10,"pointsDelta":3}}}
            """.trimIndent()
        )
        assertEquals(3, status.scoreOne)
        assertEquals(1, status.scoreTwo)
        assertEquals("Demo Team", status.teamOneName)
        assertEquals("Rivals", status.teamTwoName)
        assertEquals(true, status.viewerPaymentSettled)
        val standing = status.rankStanding!!
        assertEquals("s1", standing.seasonId)
        assertEquals(1168.0, standing.rank, 0.0)
        assertEquals(4, standing.tier)
        val crew = standing.crew!!
        assertEquals("Vermelhos", crew.name)
        assertEquals(1, crew.place)
        assertEquals(2, crew.placeCount)
        assertEquals(10.0, crew.points, 0.0)
        assertEquals(3.0, crew.pointsDelta!!, 0.0)
    }

    @Test
    fun `defaults rankStanding viewerPaymentSettled and score fields when absent`() {
        val status = json.decodeFromString<PostGameStatus>("""{"gameEnded":true}""")
        assertNull(status.rankStanding)
        assertEquals(false, status.viewerPaymentSettled)
        assertNull(status.scoreOne)
        assertNull(status.scoreTwo)
        assertEquals("", status.teamOneName)
        assertEquals("", status.teamTwoName)
    }
}
