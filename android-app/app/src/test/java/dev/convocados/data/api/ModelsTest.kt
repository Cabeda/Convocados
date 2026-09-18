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
}
